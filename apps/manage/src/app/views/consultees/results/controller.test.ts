import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../../nunjucks.ts';
import { buildConsulteesResultsPage, buildSectionStaticMap } from './controller.ts';

describe('consultees results page', () => {
	it('should render results for a known geometry', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const handler = buildConsulteesResultsPage({ logger: mockLogger() });
		await handler({ params: { geometryId: 'geo-1' }, query: { ruleset: 'post-30-apr-2024-england-wales' } }, mockRes);

		assert.strictEqual(mockRes.render.mock.callCount(), 1);
		assert.strictEqual(mockRes.render.mock.calls[0].arguments[0], 'views/consultees/results/view.njk');
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.match(viewModel.pageHeading, /Consultees identified for/);
		assert.ok(viewModel.sections.length >= 2);
		assert.ok(viewModel.sections[0].mapConfigJson.includes('FeatureCollection'));
		assert.match(viewModel.sections[0].staticMapSrc, /\/static-map$/);
	});

	it('should 404 for an unknown geometry', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn()
		};
		const handler = buildConsulteesResultsPage({ logger: mockLogger() });
		await handler({ params: { geometryId: 'missing' }, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	const realProjectId = '44444444-4444-4444-4444-444444444444';

	function realProjectRow() {
		return {
			id: realProjectId,
			geometryType: 'Point',
			caseReference: 'EN010099',
			caseName: 'Real Test Project',
			fileName: null,
			receivedDate: null,
			acceptance: null,
			metadata: '{}',
			geometryWkt: 'POINT(-1.5 52.5)'
		};
	}

	it('should run a real railway screening query for a real project id, alongside the prototype sections', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		let call = 0;
		const db = {
			$queryRaw: mock.fn(async () => {
				call += 1;
				if (call === 1) return [realProjectRow()];
				return [
					{
						id: '55555555-5555-5555-5555-555555555555',
						geometryType: 'MultiLineString',
						consulteeCategory: 'railway',
						consultee: 'Network Rail',
						region: 'Midlands',
						caseReference: null,
						documentId: null,
						consulteeId: null,
						organisationId: null,
						currentVersion: 1,
						metadata: '{}',
						geometryWkt: 'MULTILINESTRING((-1.5 52.5, -1.4 52.6))',
						distanceMetres: 123.456
					}
				];
			})
		};

		const handler = buildConsulteesResultsPage({ db, logger: mockLogger() });
		await handler({ params: { geometryId: realProjectId }, query: {} }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.match(viewModel.pageHeading, /Real Test Project/);
		// the existing prototype sections still render, labelled with the real project now
		assert.ok(viewModel.sections.length >= 2);
		assert.ok(viewModel.realScreening);
		assert.strictEqual(viewModel.realScreening.rows.length, 1);
		assert.strictEqual(viewModel.realScreening.rows[0].consultee, 'Network Rail');
		assert.strictEqual(viewModel.realScreening.rows[0].distanceMetres, 123);
	});

	it('should default a match with no consultee/region name to null, not undefined', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn()
		};
		let call = 0;
		const db = {
			$queryRaw: mock.fn(async () => {
				call += 1;
				if (call === 1) return [realProjectRow()];
				return [
					{
						id: '66666666-6666-6666-6666-666666666666',
						geometryType: 'MultiLineString',
						consulteeCategory: 'railway',
						consultee: null,
						region: null,
						caseReference: null,
						documentId: null,
						consulteeId: null,
						organisationId: null,
						currentVersion: 1,
						metadata: '{}',
						geometryWkt: 'MULTILINESTRING((-1.5 52.5, -1.4 52.6))',
						distanceMetres: 42
					}
				];
			})
		};

		const handler = buildConsulteesResultsPage({ db, logger: mockLogger() });
		await handler({ params: { geometryId: realProjectId }, query: {} }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.realScreening.rows[0].consultee, null);
		assert.strictEqual(viewModel.realScreening.rows[0].region, null);
	});

	it('should 404 for a well-formed id that matches no real project either', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn()
		};
		const db = { $queryRaw: mock.fn(async () => []) };
		const handler = buildConsulteesResultsPage({ db, logger: mockLogger() });
		await handler({ params: { geometryId: realProjectId }, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should still render the page if the real screening query fails', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		let call = 0;
		const db = {
			$queryRaw: mock.fn(async () => {
				call += 1;
				if (call === 1) return [realProjectRow()];
				throw new Error('query failed');
			})
		};

		const handler = buildConsulteesResultsPage({ db, logger: mockLogger() });
		await handler({ params: { geometryId: realProjectId }, query: {} }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.match(viewModel.pageHeading, /Real Test Project/);
		assert.strictEqual(viewModel.realScreening, undefined);
	});

	it('should serve a static map with cache headers for a section', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			new Response(
				Buffer.from(
					'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
					'base64'
				),
				{ status: 200, headers: { 'content-type': 'image/png' } }
			);

		const mockRes = {
			status: mock.fn(() => mockRes),
			type: mock.fn(() => mockRes),
			set: mock.fn(() => mockRes),
			send: mock.fn(),
			end: mock.fn()
		};

		try {
			const handler = buildSectionStaticMap({ logger: mockLogger() }, true);
			await handler({ params: { geometryId: 'geo-1', sectionId: 'ambulance-trusts' }, headers: {} }, mockRes);
			assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 200);
			assert.match(String(mockRes.type.mock.calls[0].arguments[0]), /image\/svg\+xml/);
			assert.match(String(mockRes.set.mock.calls[0].arguments[0]['Cache-Control']), /max-age=/);
			assert.ok(mockRes.set.mock.calls[0].arguments[0].ETag);
			assert.match(String(mockRes.send.mock.calls[0].arguments[0]), /<svg/);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('should accept array ruleset query values', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn()
		};
		const handler = buildConsulteesResultsPage({ logger: mockLogger() });
		await handler({ params: { geometryId: 'geo-1' }, query: { ruleset: ['post-30-apr-2024-england-wales'] } }, mockRes);
		assert.strictEqual(mockRes.render.mock.calls[0].arguments[1].rulesetLabel.includes('England'), true);
	});

	it('should ignore non-string array ruleset values', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn()
		};
		const handler = buildConsulteesResultsPage({ logger: mockLogger() });
		await handler({ params: { geometryId: 'geo-1' }, query: { ruleset: [1] } }, mockRes);
		assert.ok(mockRes.render.mock.calls[0].arguments[1].rulesetLabel);
	});

	it('should 404 static maps for unknown geometry or section', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			type: mock.fn(() => mockRes),
			send: mock.fn(),
			set: mock.fn(() => mockRes),
			end: mock.fn()
		};
		const handler = buildSectionStaticMap({ logger: mockLogger() });
		await handler({ params: { geometryId: 'missing', sectionId: 'ambulance-trusts' }, headers: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);

		await handler({ params: { geometryId: 'geo-1', sectionId: 'missing' }, headers: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[1].arguments[0], 404);
	});

	it('should 404 when geometry and section params are missing', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			type: mock.fn(() => mockRes),
			send: mock.fn(),
			render: mock.fn(),
			set: mock.fn(() => mockRes),
			end: mock.fn()
		};
		const results = buildConsulteesResultsPage({ logger: mockLogger() });
		await results({ params: {}, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);

		const staticMap = buildSectionStaticMap({ logger: mockLogger() });
		await staticMap({ params: {}, headers: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[1].arguments[0], 404);
	});

	it('should end the response when the static map returns 304', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			new Response(
				Buffer.from(
					'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
					'base64'
				),
				{ status: 200, headers: { 'content-type': 'image/png' } }
			);

		const mockRes = {
			status: mock.fn(() => mockRes),
			type: mock.fn(() => mockRes),
			set: mock.fn(() => mockRes),
			send: mock.fn(),
			end: mock.fn()
		};

		try {
			const handler = buildSectionStaticMap({ logger: mockLogger() }, true);
			await handler({ params: { geometryId: 'geo-1', sectionId: 'ambulance-trusts' }, headers: {} }, mockRes);
			const etag = mockRes.set.mock.calls[0].arguments[0].ETag;

			mockRes.status.mock.resetCalls();
			mockRes.send.mock.resetCalls();
			mockRes.end.mock.resetCalls();

			await handler(
				{
					params: { geometryId: 'geo-1', sectionId: 'ambulance-trusts' },
					headers: { 'if-none-match': etag }
				},
				mockRes
			);

			assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 304);
			assert.strictEqual(mockRes.end.mock.callCount(), 1);
			assert.strictEqual(mockRes.send.mock.callCount(), 0);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
