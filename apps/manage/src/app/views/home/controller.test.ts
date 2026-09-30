import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../nunjucks.ts';
import { buildHomePage } from './controller.ts';

function newRow(overrides: Partial<{ id: string; caseReference: string; caseName: string }> = {}) {
	return {
		id: overrides.id ?? '11111111-1111-1111-1111-111111111111',
		geometryType: 'Point',
		caseReference: overrides.caseReference ?? 'EN010001',
		caseName: overrides.caseName ?? 'Test Wind Farm',
		fileName: null,
		receivedDate: null,
		acceptance: null,
		metadata: '{}',
		geometryWkt: 'POINT(-1.5 52.5)',
		totalCount: 1n
	};
}

function createMockDb(rows: ReturnType<typeof newRow>[] = [newRow()]) {
	return { $queryRaw: mock.fn(async () => rows) };
}

describe('home page', () => {
	it('should render without error', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const homePage = buildHomePage({ logger: mockLogger(), db: createMockDb() });
		await assert.doesNotReject(() => homePage({ query: { q: 'EN01' } }, mockRes));
		assert.strictEqual(mockRes.render.mock.callCount(), 1);
		assert.strictEqual(mockRes.render.mock.calls[0].arguments[0], 'views/home/view.njk');
		assert.strictEqual(
			mockRes.render.mock.calls[0].arguments[1].pageHeading,
			'Identify consultees for an infrastructure project'
		);
		assert.strictEqual(mockRes.render.mock.calls[0].arguments[1].geometries.length, 1);
	});

	it('should map real search results to the view model', async () => {
		const mockRes = { render: mock.fn() };
		const rows = [newRow({ id: 'aaaa', caseReference: 'TR010034', caseName: 'A66 Northern Trans-Pennine Project' })];
		const homePage = buildHomePage({ logger: mockLogger(), db: createMockDb(rows) });
		await homePage({ query: { q: 'A66' } }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.geometries.length, 1);
		assert.strictEqual(viewModel.geometries[0].id, 'aaaa');
		assert.strictEqual(viewModel.geometries[0].reference, 'TR010034');
		assert.strictEqual(viewModel.geometries[0].caseName, 'A66 Northern Trans-Pennine Project');
		assert.strictEqual(viewModel.resultsTotal, 1);
	});

	it('should format a real receivedDate for display', async () => {
		const mockRes = { render: mock.fn() };
		const rows = [{ ...newRow(), receivedDate: new Date(Date.UTC(2026, 2, 3)) }];
		const homePage = buildHomePage({ logger: mockLogger(), db: createMockDb(rows) });
		await homePage({ query: {} }, mockRes);

		assert.strictEqual(mockRes.render.mock.calls[0].arguments[1].geometries[0].received, '03/03/2026');
	});

	it('should show an empty received date when not set', async () => {
		const mockRes = { render: mock.fn() };
		const homePage = buildHomePage({ logger: mockLogger(), db: createMockDb([newRow()]) });
		await homePage({ query: {} }, mockRes);

		assert.strictEqual(mockRes.render.mock.calls[0].arguments[1].geometries[0].received, '');
	});

	it('should report the total match count from the query, not just the page length', async () => {
		const mockRes = { render: mock.fn() };
		const rows = [{ ...newRow(), totalCount: 42n }];
		const homePage = buildHomePage({ logger: mockLogger(), db: createMockDb(rows) });
		await homePage({ query: {} }, mockRes);

		assert.strictEqual(mockRes.render.mock.calls[0].arguments[1].resultsTotal, 42);
	});

	it('should show zero results when the query returns nothing', async () => {
		const mockRes = { render: mock.fn() };
		const homePage = buildHomePage({ logger: mockLogger(), db: createMockDb([]) });
		await homePage({ query: { q: 'ZZZ-NOMATCH-XXX' } }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.geometries.length, 0);
		assert.strictEqual(viewModel.resultsFrom, 0);
		assert.strictEqual(viewModel.resultsTo, 0);
		assert.strictEqual(viewModel.resultsTotal, 0);
	});

	it('should render an empty result set (not throw) when the query fails', async () => {
		const mockRes = { render: mock.fn() };
		const db = {
			$queryRaw: mock.fn(async () => {
				throw new Error('db down');
			})
		};
		const homePage = buildHomePage({ logger: mockLogger(), db });
		await assert.doesNotReject(() => homePage({ query: {} }, mockRes));

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.geometries.length, 0);
		assert.strictEqual(viewModel.resultsTotal, 0);
	});

	it('should respect the requested page size', async () => {
		const mockRes = { render: mock.fn() };
		const homePage = buildHomePage({ logger: mockLogger(), db: createMockDb([newRow()]) });
		await homePage({ query: { pageSize: '50' } }, mockRes);
		assert.strictEqual(mockRes.render.mock.calls[0].arguments[1].pageSize, 50);
	});

	it('should default to a page size of 25 for an unrecognised value', async () => {
		const mockRes = { render: mock.fn() };
		const homePage = buildHomePage({ logger: mockLogger(), db: createMockDb([]) });
		await homePage({ query: { pageSize: '999' } }, mockRes);
		assert.strictEqual(mockRes.render.mock.calls[0].arguments[1].pageSize, 25);
	});

	it('should read the first value from array query params', async () => {
		const mockRes = { render: mock.fn() };
		const homePage = buildHomePage({ logger: mockLogger(), db: createMockDb([]) });
		await homePage({ query: { q: ['A66', 'ignored'], pageSize: ['50'] } }, mockRes);
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.searchQuery, 'A66');
		assert.strictEqual(viewModel.pageSize, 50);
	});

	it('should ignore non-string array query values', async () => {
		const mockRes = { render: mock.fn() };
		const homePage = buildHomePage({ logger: mockLogger(), db: createMockDb([]) });
		await homePage({ query: { q: [1], pageSize: [{}] } }, mockRes);
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.searchQuery, '');
		assert.strictEqual(viewModel.pageSize, 25);
	});

	it('should include a real example case for the search hint', async () => {
		const mockRes = { render: mock.fn() };
		const rows = [newRow({ caseReference: 'EN010025', caseName: 'East Anglia ONE Offshore Windfarm' })];
		const homePage = buildHomePage({ logger: mockLogger(), db: createMockDb(rows) });
		await homePage({ query: {} }, mockRes);

		assert.deepStrictEqual(mockRes.render.mock.calls[0].arguments[1].exampleCase, {
			reference: 'EN010025',
			caseName: 'East Anglia ONE Offshore Windfarm'
		});
	});

	it('should show no example case when none exist yet', async () => {
		const mockRes = { render: mock.fn() };
		const homePage = buildHomePage({ logger: mockLogger(), db: createMockDb([]) });
		await homePage({ query: {} }, mockRes);
		assert.strictEqual(mockRes.render.mock.calls[0].arguments[1].exampleCase, null);
	});

	it('should render with no example case (not throw) when that query fails', async () => {
		const mockRes = { render: mock.fn() };
		let call = 0;
		const db = {
			$queryRaw: mock.fn(async () => {
				call += 1;
				if (call === 1) return [newRow()];
				throw new Error('random pick failed');
			})
		};
		const homePage = buildHomePage({ logger: mockLogger(), db });
		await assert.doesNotReject(() => homePage({ query: {} }, mockRes));

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.exampleCase, null);
		assert.strictEqual(viewModel.geometries.length, 1);
	});
});
