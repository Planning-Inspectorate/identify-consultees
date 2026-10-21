import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	consulteeCategoryFor,
	datasetCode,
	groupBySlug,
	groupForCategory,
	parseReferenceDataConfig,
	REFERENCE_DATA_CONFIG,
	UnknownDatasetError
} from './reference-data.ts';

const VALID = `
version: 1
datasets:
  AMB_EW: Ambulance Trust
  IDB_WA: " Internal Drainage District "
groups:
  Public bodies: [Ambulance Trust, Internal Drainage District, Hospital]
`;

const WITH_SUBCATEGORIES = `
version: 1
datasets:
  OWF_EW:
    category: Offshore Wind Site
    subcategories:
      Offshore  Wind Export Cables: " Offshore Wind Export Cable "
groups:
  Energy: [Offshore Wind Site, Offshore Wind Export Cable]
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

	test("reads a dataset's category and the subcategories that load as another", () => {
		const config = parseReferenceDataConfig(WITH_SUBCATEGORIES);
		assert.equal(config.datasets.get('OWF_EW'), 'Offshore Wind Site');
		assert.deepEqual(
			[...config.subcategories.get('OWF_EW')!],
			[['offshore wind export cables', 'Offshore Wind Export Cable']]
		);
		assert.equal(parseReferenceDataConfig(VALID).subcategories.size, 0);
	});

	test('reads each group, its slug and its categories, in order', () => {
		const config = parseReferenceDataConfig(`${VALID}  Energy & Waste: [DNO]`);
		assert.deepEqual(
			config.groups.map((group) => [group.name, group.slug, [...group.categories]]),
			[
				['Public bodies', 'public_bodies', ['Ambulance Trust', 'Internal Drainage District', 'Hospital']],
				['Energy & Waste', 'energy_waste', ['DNO']]
			]
		);
		assert.equal(groupForCategory('Hospital', config)?.name, 'Public bodies');
		assert.equal(groupForCategory('Railway', config), undefined);
		assert.equal(groupForCategory(null, config), undefined);
		assert.equal(groupBySlug('energy_waste', config)?.name, 'Energy & Waste');
		assert.equal(groupBySlug('nope', config), undefined);
	});

	test("puts every category the app's own datasets load as in one of the report's five groups", () => {
		assert.deepEqual(
			REFERENCE_DATA_CONFIG.groups.map((group) => group.slug),
			['administrative_boundaries', 'public_bodies', 'energy', 'transport', 'other']
		);
		assert.equal(groupForCategory('Parish Council')?.slug, 'administrative_boundaries');
		assert.equal(groupForCategory('Offshore Wind Export Cable')?.slug, 'energy');
		assert.equal(groupBySlug('transport')?.categories.has('Railway'), true);
	});

	test('reads config/reference-data.yaml', () => {
		assert.equal(REFERENCE_DATA_CONFIG.datasets.get('AMB_EW'), 'Ambulance Trust');
		assert.equal(REFERENCE_DATA_CONFIG.datasets.get('CJC_EW'), 'Corporate Joint Committee');
		// the offshore wind dataset holds sites and their export cables, which the rulesets treat apart
		assert.equal(REFERENCE_DATA_CONFIG.datasets.get('OWF_EW'), 'Offshore Wind Site');
		assert.equal(
			REFERENCE_DATA_CONFIG.subcategories.get('OWF_EW')?.get('offshore wind export cables'),
			'Offshore Wind Export Cable'
		);
	});

	for (const [title, text, message] of [
		['an empty file', '', /must be a version 1 document/],
		['another version', 'version: 2', /must be a version 1 document/],
		[
			'an unknown top-level key',
			`${VALID}\ndataset: {}`,
			/the document has "dataset" - it can only have version, datasets, groups/
		],
		['no datasets', 'version: 1\ndatasets: {}', /datasets must map/],
		['no groups', VALID.replace(/groups:\n.*\n/, ''), /groups must map each group/],
		['a group with no categories', VALID.replace(/\[Ambulance.*\]/, '[]'), /groups.Public bodies must list/],
		['a group without a name', VALID.replace('Public bodies:', '"--":'), /"--" isn't a group name/],
		[
			'a category in two groups',
			`${VALID}  Other: [Hospital]`,
			/groups: Hospital is in both Public bodies and Other - it can only be in one/
		],
		[
			'a category no group has',
			VALID.replace('Internal Drainage District, ', ''),
			/groups: no group has Internal Drainage District, which a dataset loads as/
		],
		[
			"a subcategory's category no group has",
			WITH_SUBCATEGORIES.replace(', Offshore Wind Export Cable]', ']'),
			/no group has Offshore Wind Export Cable/
		],
		['datasets as a list', 'version: 1\ndatasets: [AMB_EW]', /datasets must map/],
		['a code without its area', VALID.replace('AMB_EW', 'AMB'), /"AMB" isn't a dataset code/],
		['a lower-case code', VALID.replace('AMB_EW', 'amb_ew'), /"amb_ew" isn't a dataset code/],
		['a blank category', VALID.replace('Ambulance Trust', '""'), /datasets.AMB_EW must be a consultee category/],
		[
			'a category that is not text',
			VALID.replace('Ambulance Trust', '5'),
			/datasets.AMB_EW must be a consultee category/
		],
		[
			'an unknown dataset setting',
			WITH_SUBCATEGORIES.replace('subcategories:', 'subcategory:'),
			/datasets.OWF_EW has "subcategory" - it can only have category, subcategories/
		],
		[
			'subcategories without a category',
			WITH_SUBCATEGORIES.replace('category: Offshore Wind Site', 'category: ""'),
			/datasets.OWF_EW.category must be a consultee category/
		],
		[
			'no subcategories',
			'version: 1\ndatasets:\n  OWF_EW:\n    category: Offshore Wind Site',
			/datasets.OWF_EW.subcategories must map/
		],
		[
			"a subcategory's blank category",
			WITH_SUBCATEGORIES.replace('" Offshore Wind Export Cable "', '""'),
			/datasets.OWF_EW.subcategories.Offshore {2}Wind Export Cables must be a consultee category/
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
		assert.equal(consulteeCategoryFor('health_AMB_EW_00001', 'Health', null, config), 'Ambulance Trust');
	});

	test("keeps the file's category for an id with no dataset code", () => {
		assert.equal(consulteeCategoryFor('parish_council_E04000001', 'Parish Council', null, config), 'Parish Council');
		assert.equal(consulteeCategoryFor('src-1', undefined, undefined, config), undefined);
	});

	test("refuses a dataset the config doesn't list, naming it", () => {
		assert.throws(
			() => consulteeCategoryFor('other_HOS_EW_00001', 'Other', null, config),
			(error: Error) =>
				error instanceof UnknownDatasetError &&
				/Feature other_HOS_EW_00001 is from dataset HOS_EW, which config\/reference-data.yaml doesn't list/.test(
					error.message
				)
		);
	});

	test("gives a subcategory the config names its own category - any other, its dataset's", () => {
		const owf = parseReferenceDataConfig(WITH_SUBCATEGORIES);
		const cable = 'energy_OWF_EW_00073';
		assert.equal(
			consulteeCategoryFor(cable, 'Energy', 'offshore wind  export cables', owf),
			'Offshore Wind Export Cable'
		);
		assert.equal(consulteeCategoryFor(cable, 'Energy', 'Offshore Wind Sites', owf), 'Offshore Wind Site');
		assert.equal(consulteeCategoryFor(cable, 'Energy', null, owf), 'Offshore Wind Site');
		// a dataset with no subcategories set keeps its category, whatever its subcategory
		assert.equal(
			consulteeCategoryFor('health_AMB_EW_00001', 'Health', 'Ambulance Trusts', parseReferenceDataConfig(VALID)),
			'Ambulance Trust'
		);
	});

	test("uses the app's own config by default", () => {
		assert.equal(consulteeCategoryFor('transport_CJC_EW_00001', 'Transport', null), 'Corporate Joint Committee');
	});
});
