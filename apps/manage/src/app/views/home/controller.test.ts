import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../nunjucks.ts';
import { buildHomePage } from './controller.ts';

function createMockDb(caseBoundaryCount = 0) {
	return {
		caseBoundary: {
			count: mock.fn(async () => caseBoundaryCount)
		}
	};
}

describe('home page', () => {
	it('should render without error', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const homePage = buildHomePage({ logger: mockLogger(), db: createMockDb() });
		await assert.doesNotReject(() =>
			homePage({ query: { q: 'EN01', ruleset: 'post-apr-2025-england-wales' } }, mockRes)
		);
		assert.strictEqual(mockRes.render.mock.callCount(), 1);
		assert.strictEqual(mockRes.render.mock.calls[0].arguments[0], 'views/home/view.njk');
		assert.strictEqual(
			mockRes.render.mock.calls[0].arguments[1].pageHeading,
			'Identify consultees for an infrastructure project'
		);
		assert.ok(mockRes.render.mock.calls[0].arguments[1].geometries.length > 0);
	});

	it('should filter dummy geometries by search query', async () => {
		const mockRes = {
			render: mock.fn()
		};
		const homePage = buildHomePage({ logger: mockLogger(), db: createMockDb() });
		await homePage({ query: { q: 'A66' } }, mockRes);
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.ok(viewModel.geometries.length > 0);
		assert.ok(viewModel.geometries.every((geometry) => geometry.reference === 'TR010034'));
		assert.strictEqual(viewModel.resultsTotal, viewModel.geometries.length);
	});

	it('should include varied project types in dummy data', async () => {
		const mockRes = {
			render: mock.fn()
		};
		const homePage = buildHomePage({ logger: mockLogger(), db: createMockDb() });
		await homePage({ query: { pageSize: '100' } }, mockRes);
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		const references = new Set(viewModel.geometries.map((geometry) => geometry.reference));
		const stages = new Set(viewModel.geometries.map((geometry) => geometry.geometryProjectStage));
		const caseNames = new Set(viewModel.geometries.map((geometry) => geometry.caseName));

		assert.ok(references.size >= 20);
		assert.ok(stages.size >= 5);
		assert.ok(caseNames.size >= 20);
		assert.ok([...references].some((reference) => reference.startsWith('EN')));
		assert.ok([...references].some((reference) => reference.startsWith('TR')));
		assert.ok([...references].some((reference) => reference.startsWith('WS')));
	});

	it('should use case_boundary count from the database when available', async () => {
		const mockRes = {
			render: mock.fn()
		};
		const homePage = buildHomePage({ logger: mockLogger(), db: createMockDb(42) });
		await homePage({ query: {} }, mockRes);
		assert.strictEqual(mockRes.render.mock.calls[0].arguments[1].resultsTotal, 42);
	});

	it('should fall back to dummy dataset size when case_boundary is empty', async () => {
		const mockRes = {
			render: mock.fn()
		};
		const homePage = buildHomePage({ logger: mockLogger(), db: createMockDb(0) });
		await homePage({ query: { pageSize: '100' } }, mockRes);
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.resultsTotal, 100);
		assert.strictEqual(viewModel.geometries.length, 100);
	});

	it('should respect results per page', async () => {
		const mockRes = {
			render: mock.fn()
		};
		const homePage = buildHomePage({ logger: mockLogger(), db: createMockDb(0) });

		await homePage({ query: { pageSize: '50' } }, mockRes);
		const pageSize50 = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(pageSize50.pageSize, 50);
		assert.strictEqual(pageSize50.geometries.length, 50);
		assert.strictEqual(pageSize50.resultsTo, 50);
		assert.strictEqual(pageSize50.resultsTotal, 100);

		await homePage({ query: { pageSize: '100' } }, mockRes);
		const pageSize100 = mockRes.render.mock.calls[1].arguments[1];
		assert.strictEqual(pageSize100.pageSize, 100);
		assert.strictEqual(pageSize100.geometries.length, 100);
		assert.strictEqual(pageSize100.resultsTo, 100);
	});
});
