import type { ConsulteeMatch, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { parseReportConfig } from '../../../../report-config.ts';
import { NEARBY_NSIPS } from '../../nearby-nsips.ts';
import type { ConsulteeAreaRecord, ReportExport } from './workbook.ts';
import {
	buildReportSheets,
	exportedMetadata,
	GROUP_TABS,
	nearestBufferKm,
	parseMetadata,
	reportFileName,
	tabForCategory,
	tabForMatch,
	ukClockTime
} from './workbook.ts';

const ruleset: Ruleset = {
	id: 'test-ruleset',
	name: 'Test ruleset',
	rules: [
		{
			id: 'b_host_parish',
			name: '"B" host Parish Councils',
			group: 'Administative boundaries',
			logicType: 'intersection',
			categories: ['Parish Council'],
			bufferMetres: 0
		},
		{
			id: 'hospitals_10km',
			name: 'Hospitals',
			group: 'Public bodies',
			logicType: 'intersection',
			categories: ['Hospital'],
			bufferMetres: 10_000
		},
		{ id: 'odd', name: 'Odd', group: 'Unheard of', logicType: 'intersection', categories: ['Odd'], bufferMetres: 0 }
	]
};

function match(
	id: string,
	category: string,
	consultee: string,
	conditionId: string,
	distanceMetres = 1234.5
): ConsulteeMatch {
	return {
		feature: { id, properties: { consulteeCategory: category, consultee, region: 'Feature region' } },
		distanceMetres,
		reasons: [{ type: 'condition', conditionId }]
	} as ConsulteeMatch;
}

function record(id: string, overrides: Partial<ConsulteeAreaRecord> = {}): ConsulteeAreaRecord {
	return {
		id,
		geometryType: 'Polygon',
		sourceId: null,
		consulteeCategory: 'Parish Council',
		consulteeGroup: null,
		consulteeSubcategory: null,
		consulteeSubcategoryDescription: null,
		consultee: 'Stored name',
		region: 'East',
		metadata: '{"FID":1}',
		lastUpdated: new Date('2026-10-01T09:00:00Z'),
		...overrides
	};
}

function report(overrides: Partial<ReportExport> = {}): ReportExport {
	return {
		caseName: 'Test Solar Farm',
		caseReference: 'EN010001',
		boundaryFileName: 'site.geojson',
		boundaryReceivedDate: new Date('2026-07-06T00:00:00Z'),
		ruleset,
		generatedAt: new Date('2026-10-13T14:00:00Z'),
		identified: [],
		records: new Map(),
		added: [],
		removed: [],
		...overrides
	};
}

// the workbook as these tests build it: the same columns on every tab, every metadata attribute
const TEST_CONFIG = parseReportConfig(`
version: 2
defaults:
  columns: [consultee, category, group, subcategory, subcategoryDescription, region, whyIdentified, source]
  metadata: all
  mapKm: 10
`);

function sheetsOf(exported: ReportExport, config = TEST_CONFIG) {
	return buildReportSheets(exported, config);
}

// a cell's value, whether written bare or as a cell object
const valueOf = (cell: unknown) => (cell && typeof cell === 'object' && 'value' in cell ? cell.value : cell);
const rowValues = (row: unknown[]) => row.map(valueOf);

describe('report workbook', () => {
	it("puts a match on its first condition's group tab, matching either spelling of the first group", () => {
		assert.equal(tabForMatch(match('a', 'Parish Council', 'X', 'b_host_parish'), ruleset), 'Administrative boundaries');
		assert.equal(tabForMatch(match('a', 'Hospital', 'X', 'hospitals_10km'), ruleset), 'Public bodies');
		// an unknown group, a retired condition, or only a nearby reason all go on Other
		assert.equal(tabForMatch(match('a', 'Odd', 'X', 'odd'), ruleset), 'Other');
		assert.equal(tabForMatch(match('a', 'Odd', 'X', 'retired'), ruleset), 'Other');
		const nearbyOnly = {
			...match('a', 'Odd', 'X', 'odd'),
			reasons: [{ type: 'nearby' as const, radiusMetres: 20_000 }]
		};
		assert.equal(tabForMatch(nearbyOnly, ruleset), 'Other');
	});

	it("puts a hand-added consultee on its category's group tab, else Other", () => {
		assert.equal(tabForCategory('Hospital', ruleset), 'Public bodies');
		assert.equal(tabForCategory('Landowner', ruleset), 'Other');
	});

	it('puts Nearby NSIPs on their own tab, found or added by hand', () => {
		const nearbyNsip = {
			...match('n', NEARBY_NSIPS, 'Neighbouring Solar Farm (EN010200)', 'odd'),
			reasons: [{ type: 'nearbyNsip' as const, radiusMetres: 10_000 }]
		};
		assert.equal(tabForMatch(nearbyNsip, ruleset), NEARBY_NSIPS);
		assert.equal(tabForCategory(NEARBY_NSIPS, ruleset), NEARBY_NSIPS);
	});

	it('writes a Summary tab, the five group tabs, then Nearby NSIPs', () => {
		const sheets = sheetsOf(report());
		assert.deepStrictEqual(
			sheets.map((sheet) => sheet.sheet),
			['Summary', 'Administrative boundaries', 'Public bodies', 'Energy', 'Transport', 'Other', NEARBY_NSIPS]
		);
		assert.deepStrictEqual(GROUP_TABS.at(-1), NEARBY_NSIPS);
	});

	it("lists each Nearby NSIP with its case's details from its record, and counts them in the Summary", () => {
		const nearbyNsip = {
			...match('n', NEARBY_NSIPS, 'Neighbouring Solar Farm (EN010200)', 'odd', 2_345),
			reasons: [{ type: 'nearbyNsip' as const, radiusMetres: 10_000 }]
		};
		const sheets = sheetsOf(
			report({
				identified: [nearbyNsip],
				records: new Map([
					[
						'n',
						record('n', {
							consulteeCategory: NEARBY_NSIPS,
							consulteeGroup: NEARBY_NSIPS,
							consultee: 'Neighbouring Solar Farm (EN010200)',
							region: null,
							metadata: JSON.stringify({ 'Case reference': 'EN010200', 'Distance (km)': 2.35 })
						})
					]
				])
			})
		);
		const tab = sheets.find((sheet) => sheet.sheet === NEARBY_NSIPS)!;
		const header = rowValues(tab.data[0]);
		const row = rowValues(tab.data[1]);
		assert.equal(row[header.indexOf('Consultee')], 'Neighbouring Solar Farm (EN010200)');
		assert.equal(row[header.indexOf('Category')], NEARBY_NSIPS);
		assert.equal(row[header.indexOf('Why identified')], 'Another NSIP within 10km of the site');
		assert.equal(row[header.indexOf('Case reference')], 'EN010200');
		assert.equal(row[header.indexOf('Distance (km)')], 2.35);
		const summary = sheets[0].data.map(rowValues);
		assert.deepStrictEqual(
			summary.find((cells) => cells[0] === NEARBY_NSIPS),
			[NEARBY_NSIPS, 1]
		);
	});

	it('warns on the Summary when the run screened the bounding box rather than the outline', () => {
		const screenedAgainst = (sheets: ReturnType<typeof buildReportSheets>) =>
			sheets[0].data.map(rowValues).find((cells) => cells[0] === 'Screened against')?.[1];
		assert.strictEqual(screenedAgainst(sheetsOf(report())), undefined);
		assert.match(
			String(screenedAgainst(sheetsOf(report({ siteScreenedAs: 'boundingBox' })))),
			/^The site's bounding box - its outline was too detailed to screen in time/
		);
	});

	it('lists each consultee with its stored columns, sorted by category then name', () => {
		const sheets = sheetsOf(
			report({
				identified: [
					match('b', 'Parish Council', 'Zeal Parish Council', 'b_host_parish'),
					match('a', 'Parish Council', 'Abbey Parish Council', 'b_host_parish', 5),
					match('h', 'Hospital', 'General Hospital', 'hospitals_10km')
				],
				records: new Map([
					[
						'a',
						record('a', {
							consultee: 'Abbey Parish Council',
							region: 'Stored region',
							consulteeGroup: 'Local Authorities',
							consulteeSubcategory: 'Town Council',
							consulteeSubcategoryDescription: 'A parish with a town council'
						})
					],
					['h', record('h', { consulteeCategory: 'Hospital', consultee: 'General Hospital' })]
				]),
				added: [{ category: 'Parish Council', name: 'Added Parish', reason: '' }]
			})
		);
		const admin = sheets.find((sheet) => sheet.sheet === 'Administrative boundaries')!;
		// who and what kind, where, why and where from - then the source data's own attributes
		assert.deepStrictEqual(rowValues(admin.data[0]), [
			'Consultee',
			'Category',
			'Group',
			'Subcategory',
			'Subcategory description',
			'Region',
			'Why identified',
			'Source',
			'FID'
		]);
		assert.deepStrictEqual(admin.data.slice(1).map(rowValues), [
			// the stored row's values win over the run's
			[
				'Abbey Parish Council',
				'Parish Council',
				'Local Authorities',
				'Town Council',
				'A parish with a town council',
				'Stored region',
				'"B" host Parish Councils: intersects the site',
				'Ruleset',
				1
			],
			// added by hand, with the default reason
			['Added Parish', 'Parish Council', null, null, null, null, 'Manually added', 'Manually added', null],
			// no stored row (deleted mid-request) - the run's values, and no metadata
			[
				'Zeal Parish Council',
				'Parish Council',
				null,
				null,
				null,
				'Feature region',
				'"B" host Parish Councils: intersects the site',
				'Ruleset',
				null
			]
		]);
		// a number in the metadata stays a number
		assert.deepStrictEqual(admin.data[1][8], { type: Number, value: 1 });

		const publicBodies = sheets.find((sheet) => sheet.sheet === 'Public bodies')!;
		assert.equal(publicBodies.data.length, 2);
	});

	it("spreads each tab's metadata into a column per attribute, blank where a consultee lacks one", () => {
		const sheets = sheetsOf(
			report({
				identified: [
					match('a', 'Parish Council', 'Abbey', 'b_host_parish'),
					match('b', 'Parish Council', 'Barton', 'b_host_parish'),
					match('c', 'Parish Council', 'Christleton', 'b_host_parish'),
					match('d', 'Parish Council', 'Dodleston', 'b_host_parish'),
					match('h', 'Hospital', 'General Hospital', 'hospitals_10km')
				],
				records: new Map([
					['a', record('a', { metadata: '{"PARNCP":"Abbey","FID":7,"open":true,"area":{"ha":12}}' })],
					['b', record('b', { metadata: '{"FID":8,"PARNCP":null,"note":""}' })],
					// a list of values as text, and not JSON at all kept whole
					['c', record('c', { metadata: '[1,2]' })],
					['d', record('d', { metadata: 'not json' })],
					['h', record('h', { consulteeCategory: 'Hospital', metadata: '{"ODS":"RX1"}' })]
				])
			})
		);
		const admin = sheets.find((sheet) => sheet.sheet === 'Administrative boundaries')!;
		// after the 8 fixed columns, a column per attribute - a nested one under its dotted name
		assert.deepStrictEqual(rowValues(admin.data[0]).slice(8), ['PARNCP', 'FID', 'open', 'area.ha', 'note', 'Metadata']);
		assert.deepStrictEqual(
			admin.data.slice(1).map((row) => rowValues(row).slice(8)),
			[
				['Abbey', 7, true, 12, null, null],
				[null, 8, null, null, null, null],
				[null, null, null, null, null, '1, 2'],
				[null, null, null, null, null, 'not json']
			]
		);
		// numbers and true/false keep their types
		assert.deepStrictEqual(admin.data[1][9], { type: Number, value: 7 });
		assert.deepStrictEqual(admin.data[1][10], { type: Boolean, value: true });
		// a column per attribute, sized to its name
		assert.deepStrictEqual(
			admin.columns.slice(8).map((column) => column.width),
			[12, 12, 12, 12, 12, 12]
		);

		// another tab has its own data's attributes
		const publicBodies = sheets.find((sheet) => sheet.sheet === 'Public bodies')!;
		assert.deepStrictEqual(rowValues(publicBodies.data[0]).slice(8), ['ODS']);
		assert.deepStrictEqual(rowValues(publicBodies.data[1]).slice(8), ['RX1']);
	});

	it('reads metadata as plain values - nested, held as text, or listed - never as JSON', () => {
		assert.deepStrictEqual(
			parseMetadata(
				JSON.stringify({
					CODE: 'NEW_FOREST_E_NAT_PARK',
					area: { ha: 12, survey: { year: 2024 } },
					// an earlier export's attributes, nested as text
					meta_json: '{"NAME":"New Forest"}',
					tags: ['a', null, '', 'b'],
					parts: [{ n: 1 }, { n: 2, kind: { name: 'cable' } }],
					note: '{not json',
					empty: []
				})
			),
			{
				CODE: 'NEW_FOREST_E_NAT_PARK',
				'area.ha': 12,
				'area.survey.year': 2024,
				'meta_json.NAME': 'New Forest',
				tags: 'a, b',
				parts: 'n: 1, n: 2; kind.name: cable',
				note: '{not json',
				empty: ''
			}
		);
		// a JSON value that isn't an object, a list of them, and nothing at all
		assert.deepStrictEqual(parseMetadata('"text"'), { Metadata: '"text"' });
		assert.deepStrictEqual(parseMetadata('[{"a":1}]'), { Metadata: 'a: 1' });
		assert.deepStrictEqual(parseMetadata(undefined), {});
	});

	it("summarises the report: its details, each tab's total and labelled lines, then additions and removals", () => {
		const config = parseReportConfig(`
version: 2
defaults: { columns: [consultee], metadata: none, mapKm: 10 }
tabs:
  Administrative boundaries:
    categories:
      Parish Council: { summary: 'Parish, Town and Community Councils' }
      Lower Tier Authority: { summary: District Councils }
  Public bodies:
    categories:
      Ambulance Trust: { summary: { 1: Ambulance Trusts (1km buffer), 10: Ambulance Trusts (10km buffer) } }
      Internal Drainage Board: { summary: Internal Drainage Boards }
      Internal Drainage District: { summary: Internal Drainage Boards }
  NSIPs:
    categories:
      NSIPs: { summary: National infrastructure projects }
`);
		const withDrainage: Ruleset = {
			...ruleset,
			rules: [
				...ruleset.rules,
				{
					id: 'idb',
					name: 'Drainage',
					group: 'Public bodies',
					logicType: 'intersection',
					categories: ['Internal Drainage Board', 'Internal Drainage District'],
					bufferMetres: 0
				},
				...[1_000, 10_000].map((bufferMetres) => ({
					id: `ambulance_${bufferMetres}`,
					name: 'Ambulance Trusts',
					group: 'Public bodies',
					logicType: 'intersection' as const,
					categories: ['Ambulance Trust'],
					bufferMetres
				}))
			]
		};
		// within 1km meets both conditions - counted on the nearest; the other within 10km only
		const nearAmbulance = {
			...match('n1', 'Ambulance Trust', 'Near Trust', 'ambulance_1000'),
			reasons: [
				{ type: 'condition' as const, conditionId: 'ambulance_10000' },
				{ type: 'condition' as const, conditionId: 'ambulance_1000' }
			]
		};
		const uncategorised = { ...match('u', 'x', 'Unknown', 'odd'), feature: { id: 'u', properties: {} } };
		const sheets = sheetsOf(
			report({
				ruleset: withDrainage,
				identified: [
					nearAmbulance,
					match('n2', 'Ambulance Trust', 'Far Trust', 'ambulance_10000'),
					match('a', 'Parish Council', 'Abbey', 'b_host_parish'),
					match('z', 'Parish Council', 'Zeal', 'b_host_parish'),
					match('b', 'Internal Drainage Board', 'Board', 'idb'),
					match('d', 'Internal Drainage District', 'District', 'idb'),
					match('o', 'Odd', 'Oddity', 'odd'),
					uncategorised as ConsulteeMatch,
					{
						...match('n', NEARBY_NSIPS, 'Neighbouring Solar Farm (EN010200)', 'odd'),
						reasons: [{ type: 'nearbyNsip', radiusMetres: 35_000 }]
					}
				],
				added: [
					{ category: 'Hospital', name: 'Added Hospital', reason: 'Asked to be consulted' },
					{ category: 'Ambulance Trust', name: 'Added Trust', reason: 'Covers the access road' },
					{ category: NEARBY_NSIPS, name: 'Far Highway (TR010099)', reason: 'Shares the access road' }
				],
				removed: [{ matchId: 'r', category: 'Parish Council', name: 'Removed Parish', reason: 'Dissolved' }]
			}),
			config
		);
		const summary = sheets[0].data;
		const values = summary.map(rowValues);
		const at = (label: string) => values.findIndex((cells) => cells[0] === label);

		assert.deepStrictEqual(values.slice(0, 10), [
			['Consultee report'],
			[],
			['Project', 'Test Solar Farm'],
			['Case reference', 'EN010001'],
			['Boundary file', 'site.geojson'],
			['Boundary received', '6 July 2026'],
			['Ruleset', 'Test ruleset'],
			// 14:00 UTC is 15:00 in the UK in October
			['Report generated date', new Date('2026-10-13T15:00:00Z')],
			// left for whoever sends it to fill in
			['Report generated by', ''],
			[]
		]);
		assert.deepStrictEqual(summary[8][1], {
			value: '',
			backgroundColor: '#FFDD00',
			borderStyle: 'thin',
			borderColor: '#0B0C0C'
		});
		assert.deepStrictEqual(summary[7][1], {
			type: Date,
			value: new Date('2026-10-13T15:00:00Z'),
			format: 'd mmmm yyyy hh:mm'
		});
		// each tab's total, then its lines - labelled ones in order, shown at 0, then the rest by name
		// - a category split by buffer counted on each consultee's nearest, one added by hand on its own
		assert.deepStrictEqual(values.slice(at('Tab'), at('Identified by the ruleset') + 1), [
			['Tab', 'Consultees'],
			['Administrative boundaries - Total', 2],
			['Parish, Town and Community Councils', 2],
			['District Councils', 0],
			['Public bodies - Total', 6],
			['Ambulance Trusts (1km buffer)', 1],
			['Ambulance Trusts (10km buffer)', 1],
			['Internal Drainage Boards', 2],
			['Ambulance Trust', 1],
			['Hospital', 1],
			['Energy - Total', 0],
			['Transport - Total', 0],
			['Other - Total', 2],
			['No category', 1],
			['Odd', 1],
			['National infrastructure projects', 2],
			[],
			['Total', 12],
			[],
			['Identified by the ruleset', 9]
		]);
		assert.deepStrictEqual(summary[at('Parish, Town and Community Councils')][0], {
			value: 'Parish, Town and Community Councils',
			indent: 1
		});
		assert.deepStrictEqual(summary[at('Public bodies - Total')][1], { type: Number, value: 6, fontWeight: 'bold' });
		// Nearby NSIPs are one line, their tab's own
		assert.deepStrictEqual(summary[at('National infrastructure projects')][0], {
			value: 'National infrastructure projects',
			fontWeight: 'bold'
		});
		assert.deepStrictEqual(values.slice(at('Manually added')), [
			['Manually added', 3],
			['Removed', 1],
			[],
			['Added consultees'],
			['Consultee', 'Category', 'Reason'],
			['Added Hospital', 'Hospital', 'Asked to be consulted'],
			['Added Trust', 'Ambulance Trust', 'Covers the access road'],
			['Far Highway (TR010099)', NEARBY_NSIPS, 'Shares the access road'],
			[],
			['Removed consultees'],
			['Consultee', 'Category', 'Reason'],
			['Removed Parish', 'Parish Council', 'Dissolved'],
			[],
			// those found, with the query that found them, then those added by hand, with the reason given -
			// each typed from its case reference
			['List of National infrastructure projects'],
			['Name', 'Number', 'Type', 'Sub-type', 'Query'],
			['Neighbouring Solar Farm', 'EN010200', 'Energy', 'Generating Stations', '35km buffer'],
			['Far Highway', 'TR010099', 'Transport', 'Highways', 'Shares the access road']
		]);
	});

	it('lists a Nearby NSIP without a name as blanks, rather than leaving it out', () => {
		const unnamed = {
			feature: { id: 'n', properties: { consulteeCategory: NEARBY_NSIPS, consultee: null } },
			distanceMetres: 100,
			reasons: [{ type: 'nearbyNsip', radiusMetres: 10_000 }]
		} as unknown as ConsulteeMatch;
		const summary = sheetsOf(report({ identified: [unnamed] }))[0].data.map(rowValues);
		assert.deepStrictEqual(summary.at(-1), [null, null, null, null, '10km buffer']);
	});

	it("finds a consultee's nearest buffer from the conditions that found it - none without a buffer condition", () => {
		const rules: Ruleset = {
			...ruleset,
			rules: [
				...ruleset.rules,
				{ id: 'touching', name: 'Touching', group: 'Other', logicType: 'intersection', categories: ['Odd'] },
				{
					id: 'bordering',
					name: 'Bordering',
					group: 'Other',
					logicType: 'bordering',
					categories: ['Odd'],
					hostCategory: 'Odd'
				}
			]
		};
		const found = (...conditionIds: string[]) =>
			({
				...match('x', 'Odd', 'X', 'odd'),
				reasons: conditionIds.map((conditionId) => ({ type: 'condition', conditionId }))
			}) as ConsulteeMatch;
		assert.equal(nearestBufferKm(found('hospitals_10km', 'b_host_parish'), rules), 0);
		assert.equal(nearestBufferKm(found('hospitals_10km'), rules), 10);
		// a condition with no buffer set must touch the site
		assert.equal(nearestBufferKm(found('touching'), rules), 0);
		assert.equal(nearestBufferKm(found('bordering', 'retired'), rules), undefined);
		assert.equal(
			nearestBufferKm({ ...found(), reasons: [{ type: 'nearby', radiusMetres: 20_000 }] } as ConsulteeMatch, rules),
			undefined
		);
	});

	it('writes times as a clock in the UK shows them, in summer and winter', () => {
		assert.deepStrictEqual(ukClockTime(new Date('2026-07-01T08:35:20Z')), new Date('2026-07-01T09:35:20Z'));
		assert.deepStrictEqual(ukClockTime(new Date('2026-12-01T09:35:00Z')), new Date('2026-12-01T09:35:00Z'));
		// past midnight in the UK, still the day before in UTC
		assert.deepStrictEqual(ukClockTime(new Date('2026-06-30T23:30:00Z')), new Date('2026-07-01T00:30:00Z'));
	});

	it('leaves details it does not have blank, and lists no additions or removals when there are none', () => {
		const summary = sheetsOf(report({ boundaryFileName: null, boundaryReceivedDate: null }))[0].data.map(rowValues);
		const row = (label: string) => summary.find((cells) => cells[0] === label);
		assert.deepStrictEqual(row('Boundary file'), ['Boundary file', null]);
		assert.deepStrictEqual(row('Boundary received'), ['Boundary received', null]);
		// always left to fill in
		assert.deepStrictEqual(row('Report generated by'), ['Report generated by', '']);
		assert.deepStrictEqual(summary.slice(-8), [
			['Added consultees'],
			['Consultee', 'Category', 'Reason'],
			[],
			['Removed consultees'],
			['Consultee', 'Category', 'Reason'],
			[],
			['List of National infrastructure projects'],
			['Name', 'Number', 'Type', 'Sub-type', 'Query']
		]);
	});

	it('gives a consultee added by hand its stored region and metadata', () => {
		const admin = sheetsOf(
			report({
				records: new Map([['p', record('p', { region: 'Stored region' })]]),
				added: [{ id: 'p', category: 'Parish Council', name: 'Picked Parish', reason: 'Borders the site' }]
			})
		).find((sheet) => sheet.sheet === 'Administrative boundaries')!;
		assert.deepStrictEqual(rowValues(admin.data[1]), [
			'Picked Parish',
			'Parish Council',
			null,
			null,
			null,
			'Stored region',
			'Borders the site',
			'Manually added',
			1
		]);
	});

	it('leaves cells blank for a consultee with no name, category or region anywhere', () => {
		const unnamed = {
			feature: { id: 'u', properties: { consulteeCategory: null, consultee: null, region: null } },
			distanceMetres: null,
			reasons: [{ type: 'condition', conditionId: 'b_host_parish' }]
		} as unknown as ConsulteeMatch;
		const admin = sheetsOf(report({ identified: [unnamed] })).find(
			(sheet) => sheet.sheet === 'Administrative boundaries'
		)!;
		assert.deepStrictEqual(rowValues(admin.data[1]), [
			null,
			null,
			null,
			null,
			null,
			null,
			'"B" host Parish Councils: intersects the site',
			'Ruleset'
		]);
	});

	it('names the file by reference, ruleset and date, without characters file systems reject', () => {
		assert.equal(reportFileName(report()), 'EN010001 Test ruleset consultees 2026-10-13.xlsx');
		// the ZIP holding the workbook and the maps
		assert.equal(reportFileName(report(), 'zip'), 'EN010001 Test ruleset consultee report 2026-10-13.zip');
		assert.equal(
			reportFileName(report({ caseReference: 'EN/01:02' })),
			'EN-01-02 Test ruleset consultees 2026-10-13.xlsx'
		);
	});

	it("builds each tab from config/report.yaml's own columns and metadata", () => {
		const generator = {
			...match('g', 'Electricity Generator', 'Solar Farm', 'odd', 2_500),
			reasons: [{ type: 'condition' as const, conditionId: 'generators' }]
		};
		const withGenerators: Ruleset = {
			...ruleset,
			rules: [
				...ruleset.rules,
				{
					id: 'generators',
					name: 'Electricity generators',
					group: 'Energy',
					logicType: 'intersection',
					categories: ['Electricity Generator'],
					bufferMetres: 10_000
				}
			]
		};
		const sheets = buildReportSheets(
			report({
				ruleset: withGenerators,
				identified: [generator, match('a', 'Parish Council', 'Abbey', 'b_host_parish')],
				records: new Map([
					[
						'g',
						record('g', {
							consultee: 'Solar Farm',
							consulteeCategory: 'Electricity Generator',
							consulteeSubcategory: 'Solar',
							metadata: JSON.stringify({ NAME: 'Solar Farm (England)', PRIMARY_TYPE: 'Solar', LAT: '51.3' })
						})
					],
					[
						'a',
						record('a', { consultee: 'Abbey', metadata: JSON.stringify({ CODE: 'E04000001', NAME: 'Abbey', FID: 7 }) })
					]
				])
			})
		);
		const energy = sheets.find((sheet) => sheet.sheet === 'Energy')!;
		assert.deepStrictEqual(rowValues(energy.data[0]), [
			'Consultee',
			'Category',
			'Subcategory',
			'Subcategory description',
			'Distance from site (km)',
			'Why identified',
			'Source',
			// every attribute the category lists, blank where this consultee has none
			'Official name',
			'Operator',
			'Technology',
			'Capacity (MW)',
			'Status',
			'Commissioned',
			'PINS reference',
			'DUKES reference'
		]);
		assert.deepStrictEqual(rowValues(energy.data[1]).slice(-8), [
			'Solar Farm (England)',
			null,
			'Solar',
			null,
			null,
			null,
			null,
			null
		]);
		const admin = sheets.find((sheet) => sheet.sheet === 'Administrative boundaries')!;
		// only the attributes listed - CODE and NAME, not FID
		assert.deepStrictEqual(rowValues(admin.data[0]), [
			'Consultee',
			'Category',
			'Why identified',
			'Source',
			'Code',
			'Official name'
		]);
		assert.deepStrictEqual(rowValues(admin.data[1]).slice(-2), ['E04000001', 'Abbey']);
		// no tab shows a consultee's region
		assert.ok(sheets.slice(1).every((sheet) => !rowValues(sheet.data[0]).includes('Region')));
	});

	it('has the columns config/report.yaml lists for its tab, in its order - any of the stored ones', () => {
		const config = parseReportConfig(
			[
				'version: 2',
				'defaults:',
				'  columns: [lastUpdated, consultee, distanceKm, consulteeAreaId, geometryType, sourceId, group, subcategory, subcategoryDescription, source]',
				'  metadata: none',
				'  mapKm: 10'
			].join('\n')
		);
		const admin = sheetsOf(
			report({
				identified: [match('a', 'Parish Council', 'Abbey', 'b_host_parish', 2500)],
				records: new Map([
					[
						'a',
						record('a', {
							consultee: 'Abbey',
							sourceId: 'local_authorities_PAR_EW_00001',
							consulteeGroup: 'Local Authorities',
							consulteeSubcategory: 'Active',
							consulteeSubcategoryDescription: 'Railway line in use'
						})
					]
				]),
				// one the run found, with its distance; one added by name alone
				added: [
					{ id: 'p', category: 'Parish Council', name: 'Picked', reason: 'r', distanceMetres: 1000 },
					{ category: 'Parish Council', name: 'Typed', reason: 'r' }
				]
			}),
			config
		).find((sheet) => sheet.sheet === 'Administrative boundaries')!;
		assert.deepStrictEqual(rowValues(admin.data[0]), [
			'Last updated',
			'Consultee',
			'Distance from site (km)',
			'Consultee area id',
			'Geometry type',
			'Source id',
			'Group',
			'Subcategory',
			'Subcategory description',
			'Source'
		]);
		assert.deepStrictEqual(admin.data.slice(1).map(rowValues), [
			[
				new Date('2026-10-01T09:00:00Z'),
				'Abbey',
				2.5,
				'a',
				'Polygon',
				'local_authorities_PAR_EW_00001',
				'Local Authorities',
				'Active',
				'Railway line in use',
				'Ruleset'
			],
			[null, 'Picked', 1, 'p', null, null, null, null, null, 'Manually added'],
			[null, 'Typed', null, null, null, null, null, null, null, 'Manually added']
		]);
		assert.deepStrictEqual(
			admin.columns.map((column) => column.width),
			[18, 36, 12, 38, 16, 30, 22, 22, 40, 16]
		);
	});

	it("exports each category's metadata as config/report.yaml sets - shared headings share a column", () => {
		const config = parseReportConfig(
			[
				'version: 2',
				'defaults: { columns: [consultee], metadata: all, mapKm: 10 }',
				'tabs:',
				'  Administrative boundaries:',
				'    categories:',
				'      Parish Council: { metadata: { PARNCP23CD: ONS code, PARNCP23NM: Name } }',
				'      Unitary Authority: { metadata: { LAD24CD: ONS code } }',
				'  Public bodies:',
				'    categories:',
				'      Hospital: { metadata: none }'
			].join('\n')
		);
		const withUnitaries: Ruleset = {
			...ruleset,
			rules: [
				...ruleset.rules,
				{
					id: 'b_host_ua',
					name: '"B" host Unitary Authorities',
					group: 'Administative boundaries',
					logicType: 'intersection',
					categories: ['Unitary Authority'],
					bufferMetres: 0
				}
			]
		};
		const sheets = sheetsOf(
			report({
				ruleset: withUnitaries,
				identified: [
					match('p', 'Parish Council', 'Abbey', 'b_host_parish'),
					match('u', 'Unitary Authority', 'Cheshire West', 'b_host_ua'),
					match('h', 'Hospital', 'General Hospital', 'hospitals_10km')
				],
				records: new Map([
					[
						'p',
						record('p', { consultee: 'Abbey', metadata: '{"PARNCP23CD":"E04000001","PARNCP23NM":"Abbey","FID":1}' })
					],
					[
						'u',
						record('u', {
							consultee: 'Cheshire West',
							consulteeCategory: 'Unitary Authority',
							metadata: '{"LAD24CD":"E06000050"}'
						})
					],
					['h', record('h', { consulteeCategory: 'Hospital', metadata: '{"ODS":"RX1"}' })]
				])
			}),
			config
		);
		const admin = sheets.find((sheet) => sheet.sheet === 'Administrative boundaries')!;
		// the listed attributes only, under their headings - both ONS codes in one column
		assert.deepStrictEqual(rowValues(admin.data[0]), ['Consultee', 'ONS code', 'Name']);
		assert.deepStrictEqual(admin.data.slice(1).map(rowValues), [
			['Abbey', 'E04000001', 'Abbey'],
			['Cheshire West', 'E06000050', null]
		]);
		// none - no metadata columns at all
		const publicBodies = sheets.find((sheet) => sheet.sheet === 'Public bodies')!;
		assert.deepStrictEqual(rowValues(publicBodies.data[0]), ['Consultee']);
	});

	it('fills a shared heading from the first listed attribute with a value', () => {
		const selection = [
			{ attribute: 'NAME_W', heading: 'Name' },
			{ attribute: 'NAME', heading: 'Name' },
			{ attribute: 'MISSING', heading: 'Code' }
		];
		assert.deepStrictEqual(
			[...exportedMetadata({ NAME_W: '', NAME: 'Abbey' }, selection)],
			[
				['Name', 'Abbey'],
				['Code', undefined]
			]
		);
		assert.deepStrictEqual([...exportedMetadata({ NAME_W: 'Abaty', NAME: 'Abbey' }, selection)][0], ['Name', 'Abaty']);
	});
});
