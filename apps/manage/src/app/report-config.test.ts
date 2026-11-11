import { REFERENCE_DATA_CONFIG } from '@pins/identify-consultees-database/src/seed/reference-data.ts';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	categorySettings,
	parseReportConfig,
	REPORT_COLUMNS,
	REPORT_CONFIG,
	REPORT_TABS,
	summaryLabelProblems,
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
      Integrated Care Boards (England): { metadata: { ICB26CD: Code, ICB26NM: Official name } }
      Police and crime commissioners: { metadata: none, mapKm: 30 }
      Ambulance trusts: { mapKm: 5 }
  Energy:
    metadata: all
  Other: {}
`;

describe('report config', () => {
	test('reads config/report.yaml: a setting for every tab, and its categories over it', () => {
		assert.ok(REPORT_CONFIG.defaults.columns.every((column) => column in REPORT_COLUMNS));
		assert.ok(REPORT_CONFIG.defaults.mapMarginMetres > 0);
		for (const tab of REPORT_TABS) {
			// every tab shows something: fixed columns, or metadata
			assert.ok(tabSettings(tab).columns.length > 0 || tabSettings(tab).metadata !== 'none', tab);
		}
		// NSIPs are their own fields alone - no fixed columns
		assert.deepEqual(tabSettings('NSIPs').columns, []);
		// the combined authorities share their metadata
		assert.deepEqual(
			categorySettings('Passenger transport executives').metadata,
			categorySettings('Integrated transport authorities').metadata
		);
		assert.deepEqual(categorySettings('Parish, town and community councils').metadata, [
			{ attribute: 'CODE', heading: 'External code' }
		]);
		// every consultee tab opens with the reference data's own id
		for (const tab of REPORT_TABS.filter((tab) => tab !== 'NSIPs')) {
			assert.equal(tabSettings(tab).columns[0], 'sourceId', tab);
		}
		// the consultee column is the name - no metadata repeats it
		const everyMetadata = [
			REPORT_CONFIG.defaults,
			...Object.values(REPORT_CONFIG.tabs),
			...Object.values(REPORT_CONFIG.categories)
		]
			.map(({ metadata }) => metadata)
			.flatMap((metadata) => (Array.isArray(metadata) ? metadata : []));
		assert.ok(!everyMetadata.some(({ heading }) => heading === 'Official name'));
		// a case's stage, as CBOS last gave it
		assert.ok((tabSettings('NSIPs').metadata as { heading: string }[]).some(({ heading }) => heading === 'Stage'));
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

		assert.deepEqual(categorySettings('Integrated Care Boards (England)', config), {
			metadata: [
				{ attribute: 'ICB26CD', heading: 'Code' },
				{ attribute: 'ICB26NM', heading: 'Official name' }
			],
			mapMarginMetres: 20_000
		});
		assert.deepEqual(categorySettings('Police and crime commissioners', config), {
			metadata: 'none',
			mapMarginMetres: 30_000
		});
		// a category not listed takes its tab's - its group's in config/reference-data.yaml
		assert.deepEqual(categorySettings('Fire and rescue authorities', config), publicBodies);
		// one setting its map size alone keeps its tab's metadata
		assert.deepEqual(categorySettings('Ambulance trusts', config), {
			metadata: publicBodies.metadata,
			mapMarginMetres: 5_000
		});
		assert.equal(
			categorySettings('Electricity distributors with compulsory purchase order powers', config).metadata,
			'all'
		);
		// and with no tab, the defaults
		for (const category of ['Not a category', null, undefined, 'constructor']) {
			assert.deepEqual(categorySettings(category, config), config.defaults, String(category));
		}
		assert.deepEqual(categorySettings('Not configured'), REPORT_CONFIG.defaults);
	});

	test("finds a category's tab from its group, Nearby NSIPs from its own", () => {
		assert.equal(tabForCategorySettings('Parish, town and community councils'), 'Administrative boundaries');
		assert.equal(tabForCategorySettings('Offshore wind export cables and sites'), 'Energy');
		assert.equal(tabForCategorySettings('NSIPs'), 'NSIPs');
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
      Police and crime commissioners: { summary: ' Police and Crime Commissioners ', metadata: all }
      Internal drainage boards (England): { summary: Internal Drainage Boards }
      Hospitals operated by NHS trusts and NHS foundation trusts (England): { mapKm: 5 }
      Internal drainage boards (Wales): { summary: Internal Drainage Boards }
`);
		assert.deepStrictEqual(summaryLines('Public bodies', config), [
			{ label: 'Police and Crime Commissioners', categories: ['Police and crime commissioners'] },
			{
				label: 'Internal Drainage Boards',
				categories: ['Internal drainage boards (England)', 'Internal drainage boards (Wales)']
			}
		]);
		// a label for each buffer: a line each, in order
		const split = parseReportConfig(`
version: 2
defaults: { columns: [consultee], metadata: none, mapKm: 1 }
tabs:
  Public bodies:
    categories:
      Ambulance trusts: { summary: { 1: Within 1km, 10: Within 10km } }
      Fire and rescue authorities: { summary: { 10: Within 10km } }
`);
		assert.deepStrictEqual(summaryLines('Public bodies', split), [
			{ label: 'Within 1km', categories: ['Ambulance trusts'], bufferKm: 1 },
			{ label: 'Within 10km', categories: ['Ambulance trusts', 'Fire and rescue authorities'], bufferKm: 10 }
		]);
		// a label leaves the category's other settings as they were
		assert.equal(categorySettings('Police and crime commissioners', config).metadata, 'all');
		assert.deepStrictEqual(summaryLines('Energy', config), []);
		// config/report.yaml labels every tab's categories in the Summary's order - every category in
		// config/reference-data.yaml, so none is left to show under its bare name
		assert.equal(summaryLines('Administrative boundaries')[0].label, 'Parish, town and community councils');
		assert.deepStrictEqual(summaryLabelProblems(), []);
		// every category but the three that file labels
		const labelled = [
			'Police and crime commissioners',
			'Internal drainage boards (England)',
			'Internal drainage boards (Wales)'
		];
		assert.deepStrictEqual(
			summaryLabelProblems(config),
			REFERENCE_DATA_CONFIG.groups
				.flatMap((group) => [...group.categories])
				.filter((category) => !labelled.includes(category))
				.map((category) => `${category} has no summary label - give it one under its tab's categories`)
		);
		assert.deepStrictEqual(summaryLines('NSIPs'), [
			{ label: 'National infrastructure projects', categories: ['NSIPs'] }
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
		[
			'columns that are not a list',
			VALID.replace('[consultee, category, source]', 'consultee'),
			/defaults.columns must list the columns, \[\] for none/
		],
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
		[
			'a negative distance',
			VALID.replace('mapKm: 30', 'mapKm: -30'),
			/categories\.Police and crime commissioners\.mapKm must be/
		],
		['a distance as text', VALID.replace('mapKm: 10', 'mapKm: "10"'), /defaults.mapKm must be a number/],
		['an unknown tab', `${VALID}  Health: {}`, /"Health" isn't a tab/],
		['tabs as a list', VALID.replace(/tabs:[^]*$/, 'tabs: [Energy]'), /tabs must map each tab/],
		['a tab that is not settings', VALID.replace('Other: {}', 'Other: 5'), /tabs.Other must be a tab's settings/],
		['a typo in a tab', VALID.replace('    metadata: all', '    metdata: all'), /tabs.Energy has "metdata"/],
		[
			'a category on the wrong tab',
			VALID.replace(
				'  Other: {}',
				'  Other:\n    categories:\n      Electricity distributors with compulsory purchase order powers: { mapKm: 5 }'
			),
			/categories\.Electricity distributors with compulsory purchase order powers: Electricity distributors with compulsory purchase order powers isn't on Other - config\/reference-data.yaml puts it in Energy/
		],
		[
			'a category in no group',
			VALID.replace('  Other: {}', '  Other:\n    categories:\n      Nowhere: { mapKm: 5 }'),
			/Nowhere isn't on Other - config\/reference-data.yaml puts it in no group/
		],
		[
			'categories as a list',
			VALID.replace(
				'  Other: {}',
				'  Other:\n    categories: [Electricity distributors with compulsory purchase order powers]'
			),
			/Other.categories must map/
		],
		[
			'a category without settings',
			VALID.replace(
				'Police and crime commissioners: { metadata: none, mapKm: 30 }',
				'Police and crime commissioners: 5'
			),
			/Police and crime commissioners must set metadata, mapKm or summary/
		],
		[
			'a blank summary label',
			VALID.replace('Ambulance trusts: { mapKm: 5 }', "Ambulance trusts: { summary: ' ' }"),
			/categories\.Ambulance trusts\.summary must be the label the Summary tab gives it/
		],
		[
			'a buffer that is not a number',
			VALID.replace('Ambulance trusts: { mapKm: 5 }', 'Ambulance trusts: { summary: { one: Within 1km } }'),
			/Ambulance trusts\.summary must be the label the Summary tab gives it, or a label for each buffer in km/
		],
		[
			'a buffer without a label',
			VALID.replace('Ambulance trusts: { mapKm: 5 }', "Ambulance trusts: { summary: { 1: ' ' } }"),
			/Ambulance trusts\.summary must be/
		],
		[
			'no buffers',
			VALID.replace('Ambulance trusts: { mapKm: 5 }', 'Ambulance trusts: { summary: {} }'),
			/Ambulance trusts\.summary must be/
		],
		[
			'a summary label that is not text',
			VALID.replace('Ambulance trusts: { mapKm: 5 }', 'Ambulance trusts: { summary: 5 }'),
			/Ambulance trusts\.summary must be the label/
		],
		[
			'a typo in a category',
			VALID.replace(
				'Police and crime commissioners: { metadata: none',
				'Police and crime commissioners: { metdata: none'
			),
			/categories\.Police and crime commissioners has "metdata"/
		],
		[
			'an unknown metadata choice',
			VALID.replace('metadata: none', 'metadata: some'),
			/Police and crime commissioners\.metadata must be all, none/
		],
		[
			'an empty metadata list',
			VALID.replace('metadata: none', 'metadata: {}'),
			/Police and crime commissioners\.metadata must be all, none/
		],
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
