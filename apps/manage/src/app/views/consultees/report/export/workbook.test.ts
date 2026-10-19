import type { ConsulteeMatch, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { parseReportConfig } from '../../../../report-config.ts';
import type { ConsulteeAreaRecord, ReportExport } from './workbook.ts';
import {
	buildReportSheets,
	exportedMetadata,
	GROUP_TABS,
	reportFileName,
	tabForCategory,
	tabForMatch
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

	it('writes a Summary tab, the five group tabs and an Other Cases placeholder', () => {
		const sheets = buildReportSheets(report());
		assert.deepStrictEqual(
			sheets.map((sheet) => sheet.sheet),
			['Summary', ...GROUP_TABS, 'Other Cases']
		);
		assert.deepStrictEqual(rowValues(sheets[6].data[1]), ['Not filled yet.']);
	});

	it('lists each consultee with its stored columns, sorted by category then name', () => {
		const sheets = buildReportSheets(
			report({
				identified: [
					match('b', 'Parish Council', 'Zeal Parish Council', 'b_host_parish'),
					match('a', 'Parish Council', 'Abbey Parish Council', 'b_host_parish', 5),
					match('h', 'Hospital', 'General Hospital', 'hospitals_10km')
				],
				records: new Map([
					['a', record('a', { consultee: 'Abbey Parish Council', region: 'Stored region' })],
					['h', record('h', { consulteeCategory: 'Hospital', consultee: 'General Hospital' })]
				]),
				added: [{ category: 'Parish Council', name: 'Added Parish', reason: '' }]
			})
		);
		const admin = sheets.find((sheet) => sheet.sheet === 'Administrative boundaries')!;
		// who, why and where from - then the source data's own attributes
		assert.deepStrictEqual(rowValues(admin.data[0]), [
			'Consultee',
			'Category',
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
				'Stored region',
				'"B" host Parish Councils: intersects the site',
				'Ruleset',
				1
			],
			// added by hand, with the default reason
			['Added Parish', 'Parish Council', null, 'Manually added', 'Manually added', null],
			// no stored row (deleted mid-request) - the run's values, and no metadata
			[
				'Zeal Parish Council',
				'Parish Council',
				'Feature region',
				'"B" host Parish Councils: intersects the site',
				'Ruleset',
				null
			]
		]);
		// a number in the metadata stays a number
		assert.deepStrictEqual(admin.data[1][5], { type: Number, value: 1 });

		const publicBodies = sheets.find((sheet) => sheet.sheet === 'Public bodies')!;
		assert.equal(publicBodies.data.length, 2);
	});

	it("spreads each tab's metadata into a column per attribute, blank where a consultee lacks one", () => {
		const sheets = buildReportSheets(
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
					// not a JSON object, or not JSON at all - kept whole
					['c', record('c', { metadata: '[1,2]' })],
					['d', record('d', { metadata: 'not json' })],
					['h', record('h', { consulteeCategory: 'Hospital', metadata: '{"ODS":"RX1"}' })]
				])
			})
		);
		const admin = sheets.find((sheet) => sheet.sheet === 'Administrative boundaries')!;
		assert.deepStrictEqual(rowValues(admin.data[0]).slice(5), ['PARNCP', 'FID', 'open', 'area', 'note', 'Metadata']);
		assert.deepStrictEqual(
			admin.data.slice(1).map((row) => rowValues(row).slice(5)),
			[
				['Abbey', 7, true, '{"ha":12}', null, null],
				[null, 8, null, null, null, null],
				[null, null, null, null, null, '[1,2]'],
				[null, null, null, null, null, 'not json']
			]
		);
		// numbers and true/false keep their types
		assert.deepStrictEqual(admin.data[1][6], { type: Number, value: 7 });
		assert.deepStrictEqual(admin.data[1][7], { type: Boolean, value: true });
		// a column per attribute, sized to its name
		assert.deepStrictEqual(
			admin.columns.slice(5).map((column) => column.width),
			[12, 12, 12, 12, 12, 12]
		);

		// another tab has its own data's attributes
		const publicBodies = sheets.find((sheet) => sheet.sheet === 'Public bodies')!;
		assert.deepStrictEqual(rowValues(publicBodies.data[0]).slice(5), ['ODS']);
		assert.deepStrictEqual(rowValues(publicBodies.data[1]).slice(5), ['RX1']);
	});

	it('summarises the report, counting each tab, and lists removals with their reasons', () => {
		const sheets = buildReportSheets(
			report({
				identified: [match('a', 'Parish Council', 'Abbey', 'b_host_parish')],
				added: [{ category: 'Hospital', name: 'Added Hospital', reason: 'Asked to be consulted' }],
				removed: [{ matchId: 'z', category: 'Parish Council', name: 'Removed Parish', reason: 'Dissolved' }]
			})
		);
		const summary = sheets[0].data.map(rowValues);
		const row = (label: string) => summary.find((cells) => cells[0] === label);
		assert.deepStrictEqual(row('Project'), ['Project', 'Test Solar Farm']);
		assert.deepStrictEqual(row('Boundary received'), ['Boundary received', '6 July 2026']);
		assert.deepStrictEqual(row('Administrative boundaries'), ['Administrative boundaries', 1]);
		assert.deepStrictEqual(row('Public bodies'), ['Public bodies', 1]);
		assert.deepStrictEqual(row('Total'), ['Total', 2]);
		assert.deepStrictEqual(row('Manually added'), ['Manually added', '1']);
		assert.deepStrictEqual(row('Removed'), ['Removed', '1']);
		assert.deepStrictEqual(row('Removed Parish'), ['Removed Parish', 'Parish Council', 'Dissolved']);
	});

	it('leaves out optional details that are missing, and the removals section when there are none', () => {
		const summary = buildReportSheets(report({ boundaryFileName: null, boundaryReceivedDate: null }))[0].data.map(
			rowValues
		);
		assert.deepStrictEqual(
			summary.find((cells) => cells[0] === 'Boundary file'),
			['Boundary file', null]
		);
		assert.deepStrictEqual(
			summary.find((cells) => cells[0] === 'Boundary received'),
			['Boundary received', null]
		);
		assert.ok(!summary.some((cells) => cells[0] === 'Removed consultees'));
	});

	it('gives a consultee added by hand its stored region and metadata', () => {
		const admin = buildReportSheets(
			report({
				records: new Map([['p', record('p', { region: 'Stored region' })]]),
				added: [{ id: 'p', category: 'Parish Council', name: 'Picked Parish', reason: 'Borders the site' }]
			})
		).find((sheet) => sheet.sheet === 'Administrative boundaries')!;
		assert.deepStrictEqual(rowValues(admin.data[1]), [
			'Picked Parish',
			'Parish Council',
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
		const admin = buildReportSheets(report({ identified: [unnamed] })).find(
			(sheet) => sheet.sheet === 'Administrative boundaries'
		)!;
		assert.deepStrictEqual(rowValues(admin.data[1]), [
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

	it('has the columns config/report.yaml lists, in its order - any of the stored ones', () => {
		const config = parseReportConfig(
			[
				'version: 1',
				'columns: [lastUpdated, consultee, distanceKm, consulteeAreaId, geometryType, sourceId, group, source]',
				'defaults: { mapKm: 10, metadata: none }'
			].join('\n')
		);
		const admin = buildReportSheets(
			report({
				identified: [match('a', 'Parish Council', 'Abbey', 'b_host_parish', 2500)],
				records: new Map([
					[
						'a',
						record('a', {
							consultee: 'Abbey',
							sourceId: 'local_authorities_PAR_EW_00001',
							consulteeGroup: 'Local Authorities'
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
				'Ruleset'
			],
			[null, 'Picked', 1, 'p', null, null, null, 'Manually added'],
			[null, 'Typed', null, null, null, null, null, 'Manually added']
		]);
		assert.deepStrictEqual(
			admin.columns.map((column) => column.width),
			[18, 36, 12, 38, 16, 30, 22, 16]
		);
	});

	it("exports each category's metadata as config/report.yaml sets - shared headings share a column", () => {
		const config = parseReportConfig(
			[
				'version: 1',
				'columns: [consultee]',
				'defaults: { mapKm: 10, metadata: all }',
				'categories:',
				'  Parish Council:',
				'    metadata: { PARNCP23CD: ONS code, PARNCP23NM: Name }',
				'  Unitary Authority:',
				'    metadata: { LAD24CD: ONS code }',
				'  Hospital:',
				'    metadata: none'
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
		const sheets = buildReportSheets(
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
