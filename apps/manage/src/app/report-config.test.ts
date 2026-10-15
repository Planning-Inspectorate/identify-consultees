import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { categorySettings, parseReportConfig, REPORT_COLUMNS, REPORT_CONFIG } from './report-config.ts';

const VALID = `
version: 1
columns: [consultee, category, distanceKm]
defaults:
  mapKm: 10
  metadata: all
categories:
  Parish Council:
    mapKm: 5
    metadata:
      PARNCP23NW: Parish name (Welsh)
      FID: Feature id
  Police:
    metadata: none
  Hospital:
    mapKm: 0.5
`;

describe('report config', () => {
	test('reads config/report.yaml', () => {
		assert.ok(REPORT_CONFIG.columns.length > 0);
		assert.ok(REPORT_CONFIG.columns.every((column) => column in REPORT_COLUMNS));
		assert.ok(REPORT_CONFIG.defaults.mapMarginMetres > 0);
	});

	test("reads the columns, the defaults, and each category's own settings over them", () => {
		const config = parseReportConfig(VALID);
		assert.deepEqual(config.columns, ['consultee', 'category', 'distanceKm']);
		assert.deepEqual(config.defaults, { mapMarginMetres: 10_000, metadata: 'all' });
		assert.deepEqual(config.categories['Parish Council'], {
			mapMarginMetres: 5_000,
			metadata: [
				{ attribute: 'PARNCP23NW', heading: 'Parish name (Welsh)' },
				{ attribute: 'FID', heading: 'Feature id' }
			]
		});
		// what a category leaves out comes from the defaults
		assert.deepEqual(config.categories.Police, { mapMarginMetres: 10_000, metadata: 'none' });
		assert.deepEqual(config.categories.Hospital, { mapMarginMetres: 500, metadata: 'all' });
	});

	test('gives a category its own settings, else the defaults', () => {
		const config = parseReportConfig(VALID);
		assert.equal(categorySettings('Parish Council', config).mapMarginMetres, 5_000);
		assert.equal(categorySettings('Ambulance Trust', config), config.defaults);
		assert.equal(categorySettings(null, config), config.defaults);
		assert.equal(categorySettings(undefined, config), config.defaults);
		// a name that's a property of every object isn't a configured category
		assert.equal(categorySettings('constructor', config), config.defaults);
		// the app's own file by default
		assert.equal(categorySettings('Not configured'), REPORT_CONFIG.defaults);
	});

	test('treats categories as optional', () => {
		const config = parseReportConfig('version: 1\ncolumns: [consultee]\ndefaults: { mapKm: 1, metadata: none }\n');
		assert.deepEqual(config.categories, {});
	});

	for (const [title, text, message] of [
		['an empty file', '', /must be a version 1 document/],
		['another version', 'version: 2', /must be a version 1 document/],
		['an unknown top-level key', `${VALID}\ncolumn: [consultee]`, /the document has "column"/],
		['no columns', VALID.replace('columns: [consultee, category, distanceKm]', 'columns: []'), /columns must list/],
		['an unknown column', VALID.replace('distanceKm', 'distance'), /"distance" isn't a column/],
		['a repeated column', VALID.replace('distanceKm', 'category'), /columns lists "category" twice/],
		['missing defaults', 'version: 1\ncolumns: [consultee]', /defaults must set mapKm and metadata/],
		[
			'defaults without metadata',
			'version: 1\ncolumns: [consultee]\ndefaults: { mapKm: 1 }',
			/defaults must set both mapKm and metadata/
		],
		['a negative distance', VALID.replace('mapKm: 5', 'mapKm: -5'), /categories.Parish Council.mapKm must be/],
		['a distance as text', VALID.replace('mapKm: 10', 'mapKm: "10"'), /defaults.mapKm must be a number/],
		[
			'a typo in a category',
			VALID.replace('    metadata: none', '    metdata: none'),
			/categories.Police has "metdata"/
		],
		[
			'an unknown metadata choice',
			VALID.replace('metadata: none', 'metadata: some'),
			/Police.metadata must be all, none/
		],
		['an empty metadata list', VALID.replace('metadata: none', 'metadata: {}'), /Police.metadata must be all, none/],
		['a blank heading', VALID.replace('Feature id', '"  "'), /metadata.FID must be a column heading/],
		['categories as a list', VALID.replace(/categories:[^]*$/, 'categories: [Police]'), /categories must map/],
		['a category without settings', VALID.replace(/categories:[^]*$/, 'categories:\n  Police: 5'), /Police must set/]
	] as const) {
		test(`refuses ${title}, naming the setting`, () => {
			assert.throws(() => parseReportConfig(text), message);
		});
	}
});
