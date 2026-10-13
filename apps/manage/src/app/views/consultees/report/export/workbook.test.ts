import type { ConsulteeMatch, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import assert from 'node:assert';
import { describe, it } from 'node:test';
import type { ConsulteeAreaRecord, ReportExport } from './workbook.ts';
import { buildReportSheets, GROUP_TABS, reportFileName, tabForCategory, tabForMatch } from './workbook.ts';

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
		consulteeCategory: 'Parish Council',
		consultee: 'Stored name',
		region: 'East',
		caseReference: null,
		documentId: null,
		consulteeId: null,
		organisationId: null,
		currentVersion: 1,
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
		// no geometry, no ids or version the reference data leaves empty, no Source - then the
		// metadata's own attributes
		assert.deepStrictEqual(rowValues(admin.data[0]), [
			'Consultee',
			'Category',
			'Region',
			'Why identified',
			'Distance from site (km)',
			'Consultee area id',
			'Geometry type',
			'Case reference',
			'Last updated',
			'FID'
		]);
		assert.deepStrictEqual(admin.data.slice(1).map(rowValues), [
			// the stored row's values win over the run's
			[
				'Abbey Parish Council',
				'Parish Council',
				'Stored region',
				'"B" host Parish Councils: intersects the site',
				0.01,
				'a',
				'Polygon',
				null,
				new Date('2026-10-01T09:00:00Z'),
				1
			],
			// added by hand, saying so in place of a reason
			['Added Parish', 'Parish Council', null, 'Added by hand', null, null, null, null, null, null],
			// no stored row (deleted mid-request) - the run's values, and no metadata
			[
				'Zeal Parish Council',
				'Parish Council',
				'Feature region',
				'"B" host Parish Councils: intersects the site',
				1.23,
				'b',
				null,
				null,
				null,
				null
			]
		]);

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
		assert.deepStrictEqual(rowValues(admin.data[0]).slice(9), ['PARNCP', 'FID', 'open', 'area', 'note', 'Metadata']);
		assert.deepStrictEqual(
			admin.data.slice(1).map((row) => rowValues(row).slice(9)),
			[
				['Abbey', 7, true, '{"ha":12}', null, null],
				[null, 8, null, null, null, null],
				[null, null, null, null, null, '[1,2]'],
				[null, null, null, null, null, 'not json']
			]
		);
		// numbers and true/false keep their types
		assert.deepStrictEqual(admin.data[1][10], { type: Number, value: 7 });
		assert.deepStrictEqual(admin.data[1][11], { type: Boolean, value: true });
		// a column per attribute, sized to its name
		assert.deepStrictEqual(
			admin.columns.slice(9).map((column) => column.width),
			[12, 12, 12, 12, 12, 12]
		);

		// another tab has its own data's attributes
		const publicBodies = sheets.find((sheet) => sheet.sheet === 'Public bodies')!;
		assert.deepStrictEqual(rowValues(publicBodies.data[0]).slice(9), ['ODS']);
		assert.deepStrictEqual(rowValues(publicBodies.data[1]).slice(9), ['RX1']);
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

	it('gives a nearby consultee added by hand its stored row, distance and metadata', () => {
		const admin = buildReportSheets(
			report({
				records: new Map([['p', record('p', { region: 'Stored region', caseReference: 'EN010001' })]]),
				added: [
					{
						id: 'p',
						category: 'Parish Council',
						name: 'Picked Parish',
						reason: 'Borders the site',
						distanceMetres: 2500
					}
				]
			})
		).find((sheet) => sheet.sheet === 'Administrative boundaries')!;
		assert.deepStrictEqual(rowValues(admin.data[1]), [
			'Picked Parish',
			'Parish Council',
			'Stored region',
			'Added by hand: Borders the site',
			2.5,
			'p',
			'Polygon',
			'EN010001',
			new Date('2026-10-01T09:00:00Z'),
			1
		]);
	});

	it('leaves cells blank for a consultee with no distance, name or category anywhere', () => {
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
			null,
			'u',
			null,
			null,
			null
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
});
