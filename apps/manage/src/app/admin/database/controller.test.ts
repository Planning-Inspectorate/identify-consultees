import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import {
	buildCaseBoundariesPage,
	buildCaseBoundaryRowPage,
	buildConsulteeAreaRowPage,
	buildConsulteeAreasPage,
	buildDatabaseOverviewPage,
	formatDateTime,
	listUrl,
	prettyMetadata
} from './controller.ts';

const updated = new Date('2026-10-13T13:39:00Z');
const areaId = '11111111-1111-1111-1111-111111111111';
const boundaryId = '22222222-2222-2222-2222-222222222222';

function area(overrides: Record<string, unknown> = {}) {
	return {
		id: areaId.toUpperCase(),
		consulteeCategory: 'Parish Council',
		consultee: 'Barton',
		region: 'North West',
		geometryType: 'Polygon',
		lastUpdated: updated,
		...overrides
	};
}

function boundary(overrides: Record<string, unknown> = {}) {
	return {
		id: boundaryId.toUpperCase(),
		caseReference: 'EN010001',
		caseName: 'Test Solar Farm',
		fileName: 'site.geojson',
		receivedDate: updated,
		geometryType: 'Polygon',
		...overrides
	};
}

// a stand-in Prisma client: each model method answers with what the test gives it
function dbWith({
	areas = [area()] as unknown[],
	areaCount = 1,
	boundaries = [boundary()] as unknown[],
	boundaryCount = 1,
	categories = [
		{ consulteeCategory: 'Hospital', _count: { _all: 2 } },
		{ consulteeCategory: 'Parish Council', _count: { _all: 1 } },
		{ consulteeCategory: null, _count: { _all: 3 } }
	] as unknown[],
	areaRow = null as unknown,
	boundaryRow = null as unknown
} = {}) {
	return {
		consulteeArea: {
			count: mock.fn(async () => areaCount),
			aggregate: mock.fn(async () => ({ _max: { lastUpdated: updated } })),
			groupBy: mock.fn(async () => categories),
			findMany: mock.fn(async () => areas),
			findUnique: mock.fn(async () => areaRow)
		},
		caseBoundary: {
			count: mock.fn(async () => boundaryCount),
			aggregate: mock.fn(async () => ({ _max: { lastUpdated: null } })),
			findMany: mock.fn(async () => boundaries),
			findUnique: mock.fn(async () => boundaryRow)
		}
	};
}

function response() {
	const res = { status: mock.fn(() => res), render: mock.fn() };
	return res;
}

const rendered = (res: ReturnType<typeof response>) => {
	const [view, model] = res.render.mock.calls[0].arguments as unknown as [string, Record<string, any>];
	return { view, model };
};

describe('admin database pages', () => {
	test('the overview gives each table its rows and last update, and the areas by category', async () => {
		const res = response();
		await buildDatabaseOverviewPage({ db: dbWith({ areaCount: 13_691 }) } as never)({} as never, res as never);

		const { view, model } = rendered(res);
		assert.equal(view, 'admin/database/overview.njk');
		assert.deepEqual(
			model.tables.map((table: Record<string, string>) => [table.name, table.rows, table.lastUpdated, table.href]),
			[
				['consultee_area', '13,691', '13 Oct 2026, 14:39', '/admin/database/consultee-areas'],
				['case_boundary', '1', '', '/admin/database/case-boundaries']
			]
		);
		assert.deepEqual(model.categories, [
			{ name: 'Hospital', rows: '2', href: '/admin/database/consultee-areas?category=Hospital' },
			{ name: 'Parish Council', rows: '1', href: '/admin/database/consultee-areas?category=Parish+Council' },
			// rows with no category can't be filtered to
			{ name: 'No category', rows: '3', href: undefined }
		]);
	});

	test('lists consultee areas filtered by category and name, a page at a time', async () => {
		const db = dbWith({
			areaCount: 120,
			areas: [area(), area({ consultee: null, consulteeCategory: null, region: null })]
		});
		const res = response();
		await buildConsulteeAreasPage({ db } as never)(
			{ query: { category: 'Parish Council', q: ' bart ', page: '2' } } as never,
			res as never
		);

		const [query] = db.consulteeArea.findMany.mock.calls[0].arguments as unknown as [Record<string, any>];
		assert.deepEqual(query.where, { consulteeCategory: 'Parish Council', consultee: { contains: 'bart' } });
		assert.equal(query.skip, 50);
		assert.equal(query.take, 50);
		const { view, model } = rendered(res);
		assert.equal(view, 'admin/database/consultee-areas.njk');
		assert.equal(model.search, 'bart');
		assert.equal(model.showing, 'Showing 51 to 52 of 120 rows.');
		// every named category to filter by, the requested one selected
		assert.deepEqual(model.categoryItems, [
			{ value: '', text: 'Every category', selected: false },
			{ value: 'Hospital', text: 'Hospital', selected: false },
			{ value: 'Parish Council', text: 'Parish Council', selected: true }
		]);
		assert.deepEqual(model.rows, [
			{
				href: `/admin/database/consultee-areas/${areaId}`,
				consultee: 'Barton',
				category: 'Parish Council',
				region: 'North West',
				geometryType: 'Polygon',
				lastUpdated: '13 Oct 2026, 14:39'
			},
			{
				href: `/admin/database/consultee-areas/${areaId}`,
				consultee: 'Unnamed consultee',
				category: '',
				region: '',
				geometryType: 'Polygon',
				lastUpdated: '13 Oct 2026, 14:39'
			}
		]);
		// the page links keep the filters
		assert.equal(model.pagination.previous.href, '/admin/database/consultee-areas?category=Parish+Council&q=bart');
		assert.equal(model.pagination.next.href, '/admin/database/consultee-areas?category=Parish+Council&q=bart&page=3');
	});

	test('reads a missing, repeated or nonsense filter as none, and an empty list as no rows', async () => {
		for (const query of [{}, { category: ['a', 'b'], q: 7, page: 'zero' }, { page: '0' }, { page: '1.5' }]) {
			const db = dbWith({ areaCount: 0, areas: [] });
			const res = response();
			await buildConsulteeAreasPage({ db } as never)({ query } as never, res as never);
			const [findArgs] = db.consulteeArea.findMany.mock.calls[0].arguments as unknown as [Record<string, any>];
			assert.deepEqual(findArgs.where, {});
			assert.equal(findArgs.skip, 0);
			const { model } = rendered(res);
			assert.equal(model.showing, 'No rows match.');
			assert.equal(model.pagination, null);
		}
	});

	test('lists case boundaries matching a reference or name', async () => {
		const db = dbWith({ boundaries: [boundary(), boundary({ fileName: null, receivedDate: null })], boundaryCount: 2 });
		const res = response();
		await buildCaseBoundariesPage({ db } as never)({ query: { q: 'EN01' } } as never, res as never);

		const [query] = db.caseBoundary.findMany.mock.calls[0].arguments as unknown as [Record<string, any>];
		assert.deepEqual(query.where, {
			OR: [{ caseReference: { contains: 'EN01' } }, { caseName: { contains: 'EN01' } }]
		});
		const { view, model } = rendered(res);
		assert.equal(view, 'admin/database/case-boundaries.njk');
		assert.equal(model.showing, 'Showing 1 to 2 of 2 rows.');
		assert.deepEqual(model.rows[1], {
			href: `/admin/database/case-boundaries/${boundaryId}`,
			caseReference: 'EN010001',
			caseName: 'Test Solar Farm',
			fileName: '',
			receivedDate: '',
			geometryType: 'Polygon'
		});

		// no search - every case boundary, a page at a time
		const everyDb = dbWith({ boundaryCount: 120 });
		const everyRes = response();
		await buildCaseBoundariesPage({ db: everyDb } as never)({ query: {} } as never, everyRes as never);
		const [everyQuery] = everyDb.caseBoundary.findMany.mock.calls[0].arguments as unknown as [Record<string, any>];
		assert.deepEqual(everyQuery.where, {});
		assert.equal(rendered(everyRes).model.pagination.next.href, '/admin/database/case-boundaries?page=2');
	});

	test('shows one row whole - every column, and its metadata indented', async () => {
		const row = {
			...area(),
			caseReference: null,
			currentVersion: 1,
			metadata: '{"FID":612,"LAT":52.06}'
		};
		const res = response();
		await buildConsulteeAreaRowPage({ db: dbWith({ areaRow: row }) } as never)(
			{ params: { id: areaId } } as never,
			res as never
		);
		const { view, model } = rendered(res);
		assert.equal(view, 'admin/database/row.njk');
		assert.equal(model.pageHeading, 'Barton');
		assert.equal(model.backLinkUrl, '/admin/database/consultee-areas');
		assert.deepEqual(model.columns.slice(-3), [
			{ name: 'lastUpdated', value: '13 Oct 2026, 14:39' },
			{ name: 'caseReference', value: '' },
			{ name: 'currentVersion', value: '1' }
		]);
		assert.equal(model.metadata, '{\n  "FID": 612,\n  "LAT": 52.06\n}');

		const unnamed = response();
		await buildConsulteeAreaRowPage({ db: dbWith({ areaRow: { ...row, consultee: null } }) } as never)(
			{ params: { id: areaId } } as never,
			unnamed as never
		);
		assert.equal(rendered(unnamed).model.pageHeading, 'Unnamed consultee');

		const caseRes = response();
		await buildCaseBoundaryRowPage({ db: dbWith({ boundaryRow: { ...boundary(), metadata: '{}' } }) } as never)(
			{ params: { id: boundaryId } } as never,
			caseRes as never
		);
		assert.equal(rendered(caseRes).model.pageHeading, 'EN010001 Test Solar Farm');
		assert.equal(rendered(caseRes).model.backLinkUrl, '/admin/database/case-boundaries');
	});

	test('404s a row that does not exist, or an id that could not be one', async () => {
		for (const [handler, params, queried] of [
			[buildConsulteeAreaRowPage, { id: areaId }, true],
			[buildConsulteeAreaRowPage, { id: 'not-an-id' }, false],
			[buildCaseBoundaryRowPage, { id: boundaryId }, true],
			[buildCaseBoundaryRowPage, {}, false]
		] as const) {
			const db = dbWith();
			const res = response();
			await handler({ db } as never)({ params } as never, res as never);
			assert.equal(res.status.mock.calls[0].arguments[0], 404);
			const lookups = db.consulteeArea.findUnique.mock.callCount() + db.caseBoundary.findUnique.mock.callCount();
			assert.equal(lookups, queried ? 1 : 0);
		}
	});

	test('formats dates in UK time, metadata that is not JSON as stored, and list URLs without defaults', () => {
		assert.equal(formatDateTime(new Date('2026-01-05T09:05:00Z')), '5 Jan 2026, 09:05');
		assert.equal(formatDateTime(null), '');
		assert.equal(prettyMetadata('not json'), 'not json');
		assert.equal(listUrl('/x', { category: '', q: '', page: 1 }), '/x');
		assert.equal(listUrl('/x', { q: 'a b', page: 2 }), '/x?q=a+b&page=2');
	});
});
