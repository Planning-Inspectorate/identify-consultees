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
  AMB_EW: Ambulance trusts
  IDB_WA: " Internal drainage boards (Wales) "
groups:
  Public bodies: [Ambulance trusts, Internal drainage boards (Wales), Hospitals operated by NHS trusts and NHS foundation trusts (England)]
`;

const WITH_SUBCATEGORIES = `
version: 1
datasets:
  OWF_EW:
    category: Offshore wind export cables and sites
    subcategories:
      Offshore  Wind Export Cables: " Offshore wind export cables and sites "
groups:
  Energy: [Offshore wind export cables and sites]
`;

describe('reference data config', () => {
	test('reads each dataset code and its category', () => {
		assert.deepEqual(
			[...parseReferenceDataConfig(VALID).datasets],
			[
				['AMB_EW', 'Ambulance trusts'],
				['IDB_WA', 'Internal drainage boards (Wales)']
			]
		);
	});

	test("reads a dataset's category and the subcategories that load as another", () => {
		const config = parseReferenceDataConfig(WITH_SUBCATEGORIES);
		assert.equal(config.datasets.get('OWF_EW'), 'Offshore wind export cables and sites');
		assert.deepEqual(
			[...config.subcategories.get('OWF_EW')!],
			[['offshore wind export cables', 'Offshore wind export cables and sites']]
		);
		assert.equal(parseReferenceDataConfig(VALID).subcategories.size, 0);
	});

	test('reads each group, its slug and its categories, in order', () => {
		const config = parseReferenceDataConfig(
			`${VALID}  Energy & Waste: [Electricity distributors with compulsory purchase order powers]`
		);
		assert.deepEqual(
			config.groups.map((group) => [group.name, group.slug, [...group.categories]]),
			[
				[
					'Public bodies',
					'public_bodies',
					[
						'Ambulance trusts',
						'Internal drainage boards (Wales)',
						'Hospitals operated by NHS trusts and NHS foundation trusts (England)'
					]
				],
				['Energy & Waste', 'energy_waste', ['Electricity distributors with compulsory purchase order powers']]
			]
		);
		assert.equal(
			groupForCategory('Hospitals operated by NHS trusts and NHS foundation trusts (England)', config)?.name,
			'Public bodies'
		);
		assert.equal(groupForCategory('Railways', config), undefined);
		assert.equal(groupForCategory(null, config), undefined);
		assert.equal(groupBySlug('energy_waste', config)?.name, 'Energy & Waste');
		assert.equal(groupBySlug('nope', config), undefined);
	});

	test("puts every category the app's own datasets load as in one of the report's five groups", () => {
		assert.deepEqual(
			REFERENCE_DATA_CONFIG.groups.map((group) => group.slug),
			['administrative_boundaries', 'public_bodies', 'energy', 'transport', 'other']
		);
		assert.equal(groupForCategory('Parish, town and community councils')?.slug, 'administrative_boundaries');
		assert.equal(groupForCategory('Offshore wind export cables and sites')?.slug, 'energy');
		assert.equal(groupBySlug('transport')?.categories.has('Railways'), true);
	});

	test('reads config/reference-data.yaml', () => {
		assert.equal(REFERENCE_DATA_CONFIG.datasets.get('AMB_EW'), 'Ambulance trusts');
		assert.equal(REFERENCE_DATA_CONFIG.datasets.get('CJC_EW'), 'Corporate joint committees (Wales)');
		// the offshore wind dataset holds sites and their export cables, which the rulesets treat apart
		assert.equal(REFERENCE_DATA_CONFIG.datasets.get('OWF_EW'), 'Offshore wind export cables and sites');
		assert.equal(
			REFERENCE_DATA_CONFIG.subcategories.get('OWF_EW')?.get('offshore wind export cables'),
			'Offshore wind export cables and sites'
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
			`${VALID}  Other: [Hospitals operated by NHS trusts and NHS foundation trusts (England)]`,
			/groups: Hospitals operated by NHS trusts and NHS foundation trusts \(England\) is in both Public bodies and Other - it can only be in one/
		],
		[
			'a category no group has',
			VALID.replace('Internal drainage boards (Wales), ', ''),
			/groups: no group has Internal drainage boards \(Wales\), which a dataset loads as/
		],
		[
			"a subcategory's category no group has",
			WITH_SUBCATEGORIES.replace('Energy: [Offshore wind export cables and sites]', 'Energy: [Railways]'),
			/no group has Offshore wind export cables and sites/
		],
		['datasets as a list', 'version: 1\ndatasets: [AMB_EW]', /datasets must map/],
		['a code without its area', VALID.replace('AMB_EW', 'AMB'), /"AMB" isn't a dataset code/],
		['a lower-case code', VALID.replace('AMB_EW', 'amb_ew'), /"amb_ew" isn't a dataset code/],
		['a blank category', VALID.replace('Ambulance trusts', '""'), /datasets.AMB_EW must be a consultee category/],
		[
			'a category that is not text',
			VALID.replace('Ambulance trusts', '5'),
			/datasets.AMB_EW must be a consultee category/
		],
		[
			'an unknown dataset setting',
			WITH_SUBCATEGORIES.replace('subcategories:', 'subcategory:'),
			/datasets.OWF_EW has "subcategory" - it can only have category, subcategories/
		],
		[
			'subcategories without a category',
			WITH_SUBCATEGORIES.replace('category: Offshore wind export cables and sites', 'category: ""'),
			/datasets.OWF_EW.category must be a consultee category/
		],
		[
			'no subcategories',
			'version: 1\ndatasets:\n  OWF_EW:\n    category: Offshore wind export cables and sites',
			/datasets.OWF_EW.subcategories must map/
		],
		[
			"a subcategory's blank category",
			WITH_SUBCATEGORIES.replace('" Offshore wind export cables and sites "', '""'),
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
		assert.equal(consulteeCategoryFor('health_AMB_EW_00001', 'Health', null, config), 'Ambulance trusts');
	});

	test("keeps the file's category for an id with no dataset code", () => {
		assert.equal(
			consulteeCategoryFor('parish_council_E04000001', 'Parish, town and community councils', null, config),
			'Parish, town and community councils'
		);
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
			'Offshore wind export cables and sites'
		);
		assert.equal(
			consulteeCategoryFor(cable, 'Energy', 'Offshore Wind Sites', owf),
			'Offshore wind export cables and sites'
		);
		assert.equal(consulteeCategoryFor(cable, 'Energy', null, owf), 'Offshore wind export cables and sites');
		// a dataset with no subcategories set keeps its category, whatever its subcategory
		assert.equal(
			consulteeCategoryFor('health_AMB_EW_00001', 'Health', 'Ambulance Trusts', parseReferenceDataConfig(VALID)),
			'Ambulance trusts'
		);
	});

	test("uses the app's own config by default", () => {
		assert.equal(
			consulteeCategoryFor('transport_CJC_EW_00001', 'Transport', null),
			'Corporate joint committees (Wales)'
		);
	});
});
