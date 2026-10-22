import { REFERENCE_DATA_CONFIG } from '@pins/identify-consultees-database/src/seed/reference-data.ts';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	categorySettings,
	parseReportConfig,
	REPORT_COLUMNS,
	REPORT_CONFIG,
	REPORT_TABS,
	summaryLines,
	tabForCategorySettings,
	tabSettings
} from './report-config.ts';

const VALID = `
version: 2
defaults:
  columns: [consultee, category, source]
  metadata: { CODE: Code, NAME: Official name }
  mapKm: 10
tabs:
  Public bodies:
    columns: [consultee, region]
    mapKm: 20
    categories:
      ICB: { metadata: { ICB26CD: Code, ICB26NM: Official name } }
      Police: { metadata: none, mapKm: 30 }
      Ambulance Trust: { mapKm: 5 }
  Energy:
    metadata: all
  Other: {}
`;

describe('report config', () => {
	test('reads config/report.yaml: a setting for every tab, and its categories over it', () => {
		assert.ok(REPORT_CONFIG.defaults.columns.every((column) => column in REPORT_COLUMNS));
		assert.ok(REPORT_CONFIG.defaults.mapMarginMetres > 0);
		for (const tab of REPORT_TABS) {
			assert.ok(tabSettings(tab).columns.length > 0, tab);
		}
		assert.deepEqual(tabSettings('Nearby NSIPs').columns, ['consultee', 'whyIdentified', 'source']);
		// the combined authorities share their metadata
		assert.deepEqual(
			categorySettings('Passenger Transport Executive').metadata,
			categorySettings('Integrated Transport Authority').metadata
		);
		assert.deepEqual(categorySettings('Parish Council').metadata, [
			{ attribute: 'CODE', heading: 'Code' },
			{ attribute: 'NAME', heading: 'Official name' }
		]);
	});

	test("resolves a tab's settings over the defaults, and a category's over its tab", () => {
		const config = parseReportConfig(VALID);
		const publicBodies = tabSettings('Public bodies', config);
		assert.deepEqual(publicBodies.columns, ['consultee', 'region']);
		assert.equal(publicBodies.mapMarginMetres, 20_000);
		assert.deepEqual(publicBodies.metadata, config.defaults.metadata);
		// a tab the file doesn't set, and one set to {}, take the defaults
		assert.deepEqual(tabSettings('Transport', config), config.defaults);
		assert.deepEqual(tabSettings('Other', config), config.defaults);
		assert.equal(tabSettings('Energy', config).metadata, 'all');

		assert.deepEqual(categorySettings('ICB', config), {
			metadata: [
				{ attribute: 'ICB26CD', heading: 'Code' },
				{ attribute: 'ICB26NM', heading: 'Official name' }
			],
			mapMarginMetres: 20_000
		});
		assert.deepEqual(categorySettings('Police', config), { metadata: 'none', mapMarginMetres: 30_000 });
		// a category not listed takes its tab's - its group's in config/reference-data.yaml
		assert.deepEqual(categorySettings('Fire and Rescue Authority', config), publicBodies);
		// one setting its map size alone keeps its tab's metadata
		assert.deepEqual(categorySettings('Ambulance Trust', config), {
			metadata: publicBodies.metadata,
			mapMarginMetres: 5_000
		});
		assert.equal(categorySettings('DNO', config).metadata, 'all');
		// and with no tab, the defaults
		for (const category of ['Not a category', null, undefined, 'constructor']) {
			assert.deepEqual(categorySettings(category, config), config.defaults, String(category));
		}
		assert.deepEqual(categorySettings('Not configured'), REPORT_CONFIG.defaults);
	});

	test("finds a category's tab from its group, Nearby NSIPs from its own", () => {
		assert.equal(tabForCategorySettings('Parish Council'), 'Administrative boundaries');
		assert.equal(tabForCategorySettings('Offshore Wind Export Cable'), 'Energy');
		assert.equal(tabForCategorySettings('Nearby NSIPs'), 'Nearby NSIPs');
		assert.equal(tabForCategorySettings('Nowhere'), undefined);
		assert.equal(tabForCategorySettings(null), undefined);
	});

	test("reads each tab's Summary lines in order, categories sharing a label sharing a line", () => {
		const config = parseReportConfig(`
version: 2
defaults: { columns: [consultee], metadata: none, mapKm: 1 }
tabs:
  Public bodies:
    categories:
      Police: { summary: ' Police and Crime Commissioners ', metadata: all }
      Internal Drainage Board: { summary: Internal Drainage Boards }
      Hospital: { mapKm: 5 }
      Internal Drainage District: { summary: Internal Drainage Boards }
`);
		assert.deepStrictEqual(summaryLines('Public bodies', config), [
			{ label: 'Police and Crime Commissioners', categories: ['Police'] },
			{ label: 'Internal Drainage Boards', categories: ['Internal Drainage Board', 'Internal Drainage District'] }
		]);
		// a label leaves the category's other settings as they were
		assert.equal(categorySettings('Police', config).metadata, 'all');
		assert.deepStrictEqual(summaryLines('Energy', config), []);
		// config/report.yaml labels every tab's categories in the Summary's order - every category in
		// config/reference-data.yaml, so none is left to show under its bare name
		assert.equal(summaryLines('Administrative boundaries')[0].label, 'Parish, Town and Community Councils');
		const labelled = new Set(REPORT_TABS.flatMap((tab) => summaryLines(tab).flatMap((line) => line.categories)));
		for (const category of REFERENCE_DATA_CONFIG.groups.flatMap((group) => [...group.categories])) {
			assert.ok(labelled.has(category), `${category} has no summary label in config/report.yaml`);
		}
		assert.deepStrictEqual(summaryLines('Nearby NSIPs'), [
			{ label: 'National infrastructure projects', categories: ['Nearby NSIPs'] }
		]);
	});

	test('treats tabs as optional', () => {
		const config = parseReportConfig('version: 2\ndefaults: { columns: [consultee], metadata: none, mapKm: 1 }\n');
		assert.deepEqual(config.tabs, {});
		assert.deepEqual(config.categories, {});
		assert.deepEqual(config.summaryLines, {});
	});

	for (const [title, text, message] of [
		['an empty file', '', /must be a version 2 document/],
		['the old version', 'version: 1', /must be a version 2 document/],
		['an unknown top-level key', `${VALID}\ncategories: {}`, /the document has "categories"/],
		['missing defaults', 'version: 2', /defaults must set columns, metadata and mapKm/],
		['a typo in the defaults', VALID.replace('  mapKm: 10', '  mapkm: 10'), /defaults has "mapkm"/],
		['no columns', VALID.replace('[consultee, category, source]', '[]'), /defaults.columns must list/],
		[
			'an unknown column',
			VALID.replace('[consultee, region]', '[consultee, place]'),
			/Public bodies.columns: "place" isn't a column/
		],
		[
			'a repeated column',
			VALID.replace('[consultee, region]', '[region, region]'),
			/Public bodies.columns lists "region" twice/
		],
		['a negative distance', VALID.replace('mapKm: 30', 'mapKm: -30'), /categories.Police.mapKm must be/],
		['a distance as text', VALID.replace('mapKm: 10', 'mapKm: "10"'), /defaults.mapKm must be a number/],
		['an unknown tab', `${VALID}  Health: {}`, /"Health" isn't a tab/],
		['tabs as a list', VALID.replace(/tabs:[^]*$/, 'tabs: [Energy]'), /tabs must map each tab/],
		['a tab that is not settings', VALID.replace('Other: {}', 'Other: 5'), /tabs.Other must be a tab's settings/],
		['a typo in a tab', VALID.replace('    metadata: all', '    metdata: all'), /tabs.Energy has "metdata"/],
		[
			'a category on the wrong tab',
			VALID.replace('  Other: {}', '  Other:\n    categories:\n      DNO: { mapKm: 5 }'),
			/categories.DNO: DNO isn't on Other - config\/reference-data.yaml puts it in Energy/
		],
		[
			'a category in no group',
			VALID.replace('  Other: {}', '  Other:\n    categories:\n      Nowhere: { mapKm: 5 }'),
			/Nowhere isn't on Other - config\/reference-data.yaml puts it in no group/
		],
		[
			'categories as a list',
			VALID.replace('  Other: {}', '  Other:\n    categories: [DNO]'),
			/Other.categories must map/
		],
		[
			'a category without settings',
			VALID.replace('Police: { metadata: none, mapKm: 30 }', 'Police: 5'),
			/Police must set metadata, mapKm or summary/
		],
		[
			'a blank summary label',
			VALID.replace('Ambulance Trust: { mapKm: 5 }', "Ambulance Trust: { summary: ' ' }"),
			/categories.Ambulance Trust.summary must be the label the Summary tab gives it/
		],
		[
			'a summary label that is not text',
			VALID.replace('Ambulance Trust: { mapKm: 5 }', 'Ambulance Trust: { summary: 5 }'),
			/Ambulance Trust.summary must be the label/
		],
		[
			'a typo in a category',
			VALID.replace('Police: { metadata: none', 'Police: { metdata: none'),
			/categories.Police has "metdata"/
		],
		[
			'an unknown metadata choice',
			VALID.replace('metadata: none', 'metadata: some'),
			/Police.metadata must be all, none/
		],
		['an empty metadata list', VALID.replace('metadata: none', 'metadata: {}'), /Police.metadata must be all, none/],
		[
			'a blank heading',
			VALID.replace('ICB26NM: Official name', 'ICB26NM: "  "'),
			/metadata.ICB26NM must be a column heading/
		]
	] as const) {
		test(`refuses ${title}, naming the setting`, () => {
			assert.throws(() => parseReportConfig(text), message);
		});
	}
});
