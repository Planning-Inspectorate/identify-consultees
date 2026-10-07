import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../../nunjucks.ts';
import { buildConsulteesResultsPage, buildResultsStaticMap } from './controller.ts';

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

function railwayMatchRow(
	overrides: Partial<{ consultee: string | null; region: string | null; consulteeCategory: string | null }> = {}
) {
	return {
		id: '55555555-5555-5555-5555-555555555555',
		geometryType: 'MultiLineString',
		consulteeCategory: overrides.consulteeCategory === undefined ? 'Railway' : overrides.consulteeCategory,
		consultee: overrides.consultee === undefined ? 'Network Rail' : overrides.consultee,
		region: overrides.region === undefined ? 'Midlands' : overrides.region,
		caseReference: null,
		documentId: null,
		consulteeId: null,
		organisationId: null,
		currentVersion: 1,
		metadata: '{}',
		geometryWkt: 'MULTILINESTRING((-1.5 52.5, -1.4 52.6))',
		distanceMetres: 123.456
	};
}

function dbReturning(rows: unknown[][]) {
	let call = 0;
	return {
		$queryRaw: mock.fn(async (sql: TemplateStringsArray) => {
			// runRuleset simplifies the site, and grows it for bordering checks, with queries on the
			// site alone (no table) - answer those with the site unchanged
			if (!/\bFROM\b/.test(sql.join(''))) return [{ wkt: realProjectRow().geometryWkt }];
			return rows[Math.min(call++, rows.length - 1)] ?? [];
		})
	};
}

describe('consultees results page', () => {
	it('should run the selected ruleset and render the matches', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const db = dbReturning([[realProjectRow()], [railwayMatchRow()]]);
		const handler = buildConsulteesResultsPage({ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000 });
		await handler({ params: { caseId: realProjectId }, query: { ruleset: 'example-ruleset' } }, mockRes);

		assert.strictEqual(mockRes.render.mock.callCount(), 1);
		assert.strictEqual(mockRes.render.mock.calls[0].arguments[0], 'views/consultees/results/view.njk');
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.match(viewModel.pageHeading, /Real Test Project/);
		assert.strictEqual(viewModel.rulesetName, 'Example ruleset');
		// this mock returns the same single row for every one of the ruleset's ~27 conditions
		// (unlike real data, where a row's category only ever matches a subset of them), so which
		// exact distance survives deduplication isn't meaningful here - just that the row shows up
		// exactly once, not once per condition that happened to "match" it
		assert.strictEqual(viewModel.matches.length, 1);
		assert.strictEqual(viewModel.matches[0].consultee, 'Network Rail');
		assert.ok(viewModel.mapConfigJson.includes('FeatureCollection'));
		// allNearby comes from the same mocked row, by default (within nearbyConsulteeRadiusMetres)
		assert.strictEqual(viewModel.nearbyMatches.length, 1);
		assert.strictEqual(viewModel.nearbyMatches[0].consultee, 'Network Rail');
		assert.strictEqual(viewModel.nearbyMatchCount, 1);
		assert.strictEqual(viewModel.nearbyRadiusKm, 20);
	});

	it('derives nearbyRadiusKm from the configured radius, not a hardcoded default', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const db = dbReturning([[realProjectRow()], []]);
		const handler = buildConsulteesResultsPage({ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 50_000 });
		await handler({ params: { caseId: realProjectId }, query: { ruleset: 'example-ruleset' } }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.nearbyRadiusKm, 50);
	});

	it('should default a match with no consultee/region/category name to null, not undefined', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([
			[realProjectRow()],
			[railwayMatchRow({ consultee: null, region: null, consulteeCategory: null })]
		]);
		const handler = buildConsulteesResultsPage({ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000 });
		await handler({ params: { caseId: realProjectId }, query: { ruleset: 'example-ruleset' } }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.matches[0].consultee, null);
		assert.strictEqual(viewModel.matches[0].region, null);
		assert.strictEqual(viewModel.matches[0].consulteeCategory, null);
	});

	it('should escape stored data in mapConfigJson so it cannot break out of the script block', async () => {
		// mapConfigJson is rendered with |safe inside <script type="application/json"> - a stored
		// case/consultee name containing </script> must not be able to terminate that element and
		// inject markup into the page (see util/inline-json.ts)
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const hostileRow = { ...realProjectRow(), caseName: '</script><img src=x onerror=alert(1)>' };
		const hostileMatch = railwayMatchRow({ consultee: '</script><script>alert(1)</script>' });
		const db = dbReturning([[hostileRow], [hostileMatch]]);
		const handler = buildConsulteesResultsPage({ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000 });
		await handler({ params: { caseId: realProjectId }, query: { ruleset: 'example-ruleset' } }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.equal(viewModel.mapConfigJson.includes('</'), false);
		// the escapes are valid JSON \uXXXX sequences - the client still parses the real data
		const parsed = JSON.parse(viewModel.mapConfigJson);
		assert.equal(parsed.projectGeojson.features[0].properties.name, '</script><img src=x onerror=alert(1)>');
		assert.equal(parsed.consulteeGeojson.features[0].properties.name, '</script><script>alert(1)</script>');
	});

	it('should 404 when caseId is missing', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const handler = buildConsulteesResultsPage({
			db: { $queryRaw: mock.fn() },
			logger: mockLogger(),
			nearbyConsulteeRadiusMetres: 20_000
		});
		await handler({ params: {}, query: { ruleset: 'example-ruleset' } }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should ignore non-string array ruleset values', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[realProjectRow()]]);
		const handler = buildConsulteesResultsPage({ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000 });
		await handler({ params: { caseId: realProjectId }, query: { ruleset: [1] } }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should show that the ruleset could not be run, not an empty result, if the ruleset query fails', async () => {
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
		const logger = mockLogger();
		const handler = buildConsulteesResultsPage({ db, logger, nearbyConsulteeRadiusMetres: 20_000 });
		await handler({ params: { caseId: realProjectId }, query: { ruleset: 'example-ruleset' } }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.match(viewModel.pageHeading, /Real Test Project/);
		assert.strictEqual(viewModel.rulesetFailed, true);
		assert.strictEqual(viewModel.retryUrl, `/consultees/${realProjectId}/results?ruleset=example-ruleset`);
		assert.deepStrictEqual(viewModel.matches, []);
		assert.strictEqual(logger.error.mock.callCount(), 1);

		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /The ruleset could not be run/);
		assert.match(html, new RegExp(`href="/consultees/${realProjectId}/results\\?ruleset=example-ruleset"`));
		assert.doesNotMatch(html, /No consultees matched this ruleset/);
		assert.doesNotMatch(html, /No consultees found within/);
	});

	it('should not flag a successful run as failed', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[realProjectRow()], []]);
		const handler = buildConsulteesResultsPage({ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000 });
		await handler({ params: { caseId: realProjectId }, query: { ruleset: 'example-ruleset' } }, mockRes);

		assert.strictEqual(mockRes.render.mock.calls[0].arguments[1].rulesetFailed, false);
	});

	it('should 404 for an unknown project', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[]]);
		const handler = buildConsulteesResultsPage({ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000 });
		await handler({ params: { caseId: realProjectId }, query: { ruleset: 'example-ruleset' } }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 for an id that is not a well-formed UUID', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const handler = buildConsulteesResultsPage({
			db: { $queryRaw: mock.fn() },
			logger: mockLogger(),
			nearbyConsulteeRadiusMetres: 20_000
		});
		await handler({ params: { caseId: 'not-a-uuid' }, query: { ruleset: 'example-ruleset' } }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 when the ruleset query param is missing', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[realProjectRow()]]);
		const handler = buildConsulteesResultsPage({ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000 });
		await handler({ params: { caseId: realProjectId }, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 for an unknown ruleset', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[realProjectRow()]]);
		const handler = buildConsulteesResultsPage({ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000 });
		await handler({ params: { caseId: realProjectId }, query: { ruleset: 'not-a-real-ruleset' } }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 for a condition id, since only whole rulesets are selectable, not one condition', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[realProjectRow()]]);
		const handler = buildConsulteesResultsPage({ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000 });
		await handler({ params: { caseId: realProjectId }, query: { ruleset: 'railway' } }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should accept array ruleset query values', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[realProjectRow()], []]);
		const handler = buildConsulteesResultsPage({ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000 });
		await handler({ params: { caseId: realProjectId }, query: { ruleset: ['example-ruleset'] } }, mockRes);
		assert.strictEqual(mockRes.render.mock.calls[0].arguments[1].rulesetName, 'Example ruleset');
	});
});

describe('consultees results static map', () => {
	it('should serve a static map with cache headers', async () => {
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
			const db = dbReturning([[realProjectRow()], []]);
			const handler = buildResultsStaticMap({ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000 }, true);
			await handler({ params: { caseId: realProjectId }, query: { ruleset: 'example-ruleset' }, headers: {} }, mockRes);
			assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 200);
			assert.match(String(mockRes.type.mock.calls[0].arguments[0]), /image\/svg\+xml/);
			assert.match(String(mockRes.set.mock.calls[0].arguments[0]['Cache-Control']), /max-age=/);
			assert.ok(mockRes.set.mock.calls[0].arguments[0].ETag);
			assert.match(String(mockRes.send.mock.calls[0].arguments[0]), /<svg/);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('should negotiate a raster format and set Vary: Accept', async () => {
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
			const db = dbReturning([[realProjectRow()], []]);
			const handler = buildResultsStaticMap({ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000 });
			await handler(
				{
					params: { caseId: realProjectId },
					query: { ruleset: 'example-ruleset' },
					headers: { accept: 'image/avif' }
				},
				mockRes
			);
			assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 200);
			assert.strictEqual(mockRes.type.mock.calls[0].arguments[0], 'image/avif');
			assert.strictEqual(mockRes.set.mock.calls[0].arguments[0].Vary, 'Accept');
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('should 503 rather than serve a cacheable empty map if the ruleset query fails', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			type: mock.fn(() => mockRes),
			set: mock.fn(() => mockRes),
			send: mock.fn()
		};
		let call = 0;
		const db = {
			$queryRaw: mock.fn(async () => {
				call += 1;
				if (call === 1) return [realProjectRow()];
				throw new Error('query failed');
			})
		};
		const handler = buildResultsStaticMap({ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000 }, true);
		await handler({ params: { caseId: realProjectId }, query: { ruleset: 'example-ruleset' }, headers: {} }, mockRes);

		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 503);
		assert.strictEqual(mockRes.set.mock.callCount(), 0);
	});

	it('should 404 when caseId is missing', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			type: mock.fn(() => mockRes),
			send: mock.fn()
		};
		const handler = buildResultsStaticMap({
			db: { $queryRaw: mock.fn() },
			logger: mockLogger(),
			nearbyConsulteeRadiusMetres: 20_000
		});
		await handler({ params: {}, query: { ruleset: 'example-ruleset' }, headers: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should accept array ruleset query values', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			type: mock.fn(() => mockRes),
			set: mock.fn(() => mockRes),
			send: mock.fn()
		};
		const db = dbReturning([[realProjectRow()], []]);
		const handler = buildResultsStaticMap({ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000 }, true);
		await handler({ params: { caseId: realProjectId }, query: { ruleset: ['example-ruleset'] }, headers: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 200);
	});

	it('should 404 for an unknown project or ruleset', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			type: mock.fn(() => mockRes),
			send: mock.fn()
		};
		const handler = buildResultsStaticMap({
			db: dbReturning([[]]),
			logger: mockLogger(),
			nearbyConsulteeRadiusMetres: 20_000
		});
		await handler({ params: { caseId: realProjectId }, query: { ruleset: 'example-ruleset' }, headers: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);

		const handlerBadRuleset = buildResultsStaticMap({
			db: dbReturning([[realProjectRow()]]),
			logger: mockLogger(),
			nearbyConsulteeRadiusMetres: 20_000
		});
		await handlerBadRuleset(
			{ params: { caseId: realProjectId }, query: { ruleset: 'not-a-real-ruleset' }, headers: {} },
			mockRes
		);
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
			const db = dbReturning([[realProjectRow()], []]);
			const handler = buildResultsStaticMap({ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000 }, true);
			await handler({ params: { caseId: realProjectId }, query: { ruleset: 'example-ruleset' }, headers: {} }, mockRes);
			const etag = mockRes.set.mock.calls[0].arguments[0].ETag;

			mockRes.status.mock.resetCalls();
			mockRes.send.mock.resetCalls();
			mockRes.end.mock.resetCalls();

			const db2 = dbReturning([[realProjectRow()], []]);
			const handler2 = buildResultsStaticMap(
				{ db: db2, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000 },
				true
			);
			await handler2(
				{
					params: { caseId: realProjectId },
					query: { ruleset: 'example-ruleset' },
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
