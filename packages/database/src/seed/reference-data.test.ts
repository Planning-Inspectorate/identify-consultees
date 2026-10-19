import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	consulteeCategoryFor,
	datasetCode,
	parseReferenceDataConfig,
	REFERENCE_DATA_CONFIG,
	UnknownDatasetError
} from './reference-data.ts';

const VALID = `
version: 1
datasets:
  AMB_EW: Ambulance Trust
  IDB_WA: " Internal Drainage District "
`;

describe('reference data config', () => {
	test('reads each dataset code and its category', () => {
		assert.deepEqual(
			[...parseReferenceDataConfig(VALID).datasets],
			[
				['AMB_EW', 'Ambulance Trust'],
				['IDB_WA', 'Internal Drainage District']
			]
		);
	});

	test('reads config/reference-data.yaml', () => {
		assert.equal(REFERENCE_DATA_CONFIG.datasets.get('AMB_EW'), 'Ambulance Trust');
		assert.equal(REFERENCE_DATA_CONFIG.datasets.get('CJC_EW'), 'Corporate Joint Committee');
	});

	for (const [title, text, message] of [
		['an empty file', '', /must be a version 1 document/],
		['another version', 'version: 2', /must be a version 1 document/],
		['an unknown top-level key', `${VALID}\ndataset: {}`, /the document has "dataset"/],
		['no datasets', 'version: 1\ndatasets: {}', /datasets must map/],
		['datasets as a list', 'version: 1\ndatasets: [AMB_EW]', /datasets must map/],
		['a code without its area', VALID.replace('AMB_EW', 'AMB'), /"AMB" isn't a dataset code/],
		['a lower-case code', VALID.replace('AMB_EW', 'amb_ew'), /"amb_ew" isn't a dataset code/],
		['a blank category', VALID.replace('Ambulance Trust', '""'), /datasets.AMB_EW must be a consultee category/],
		[
			'a category that is not text',
			VALID.replace('Ambulance Trust', '5'),
			/datasets.AMB_EW must be a consultee category/
		]
	] as const) {
		test(`refuses ${title}, naming the setting`, () => {
			assert.throws(() => parseReferenceDataConfig(text), message);
		});
	}
});

describe('datasetCode', () => {
	test("reads the dataset from a feature id that names one, whatever its group's length", () => {
		assert.equal(datasetCode('health_AMB_EW_00001'), 'AMB_EW');
		assert.equal(datasetCode('administrative_boundaries_FRS_EW_00047'), 'FRS_EW');
		assert.equal(datasetCode('railway_RAIL_EW_00124'), 'RAIL_EW');
	});

	test("finds none in an id that doesn't name one", () => {
		for (const id of [
			'parish_council_E04000001',
			'railway_RAILWAY_0001',
			'greater_london_authority_GLA',
			'offshore_wind_export_cable_WALNEY_3_OFTO',
			'E23000001',
			''
		]) {
			assert.equal(datasetCode(id), undefined, id);
		}
	});
});

describe('consulteeCategoryFor', () => {
	const config = parseReferenceDataConfig(VALID);

	test("gives a feature its dataset's category, over the file's broad group", () => {
		assert.equal(consulteeCategoryFor('health_AMB_EW_00001', 'Health', config), 'Ambulance Trust');
	});

	test("keeps the file's category for an id with no dataset code", () => {
		assert.equal(consulteeCategoryFor('parish_council_E04000001', 'Parish Council', config), 'Parish Council');
		assert.equal(consulteeCategoryFor('src-1', undefined, config), undefined);
	});

	test("refuses a dataset the config doesn't list, naming it", () => {
		assert.throws(
			() => consulteeCategoryFor('other_HOS_EW_00001', 'Other', config),
			(error: Error) =>
				error instanceof UnknownDatasetError &&
				/Feature other_HOS_EW_00001 is from dataset HOS_EW, which config\/reference-data.yaml doesn't list/.test(
					error.message
				)
		);
	});

	test("uses the app's own config by default", () => {
		assert.equal(consulteeCategoryFor('transport_CJC_EW_00001', 'Transport'), 'Corporate Joint Committee');
	});
});
