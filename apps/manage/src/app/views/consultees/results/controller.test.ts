import { mockLogger } from '#lib/testing/index.ts';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { NEARBY_REGIONAL_FILL_OPACITY, REGIONAL_FILL_OPACITY } from '../../../maps/case-geojson.ts';
import type { ConsulteeAreaMatchRow } from '../../../testing/ruleset-runner-stub.ts';
import { failingRulesetRunner, rulesetRunnerReturning } from '../../../testing/ruleset-runner-stub.ts';
import { buildResultsStaticMap } from './controller.ts';

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
		metadata: '{}',
		geometryWkt: 'MULTILINESTRING((-1.5 52.5, -1.4 52.6))',
		distanceMetres: 123.456
	};
}

// rows[0] answers the project lookup; rows[1], if given, is what the ruleset matched - returned by
// the stand-in Python function (see rulesetRunnerFor), and by the database as the map's display geometry
function dbReturning(rows: unknown[][]) {
	let call = 0;
	return {
		matchRows: (rows[1] ?? []) as ConsulteeAreaMatchRow[],
		$queryRaw: mock.fn(async (sql: TemplateStringsArray) => {
			// the map's search area is a query on the site alone (no table) - answer it with the site
			if (!/\bFROM\b/.test(sql.join(''))) return [{ wkt: realProjectRow().geometryWkt }];
			return rows[Math.min(call++, rows.length - 1)] ?? [];
		})
	};
}

function rulesetRunnerFor(db: unknown) {
	return rulesetRunnerReturning((db as { matchRows?: ConsulteeAreaMatchRow[] }).matchRows ?? []);
}

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
			const handler = buildResultsStaticMap(
				{ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000, rulesetRunner: rulesetRunnerFor(db) },
				true
			);
			await handler(
				{ params: { caseId: realProjectId }, query: { ruleset: 'england-wales-post-20240430' }, headers: {} },
				mockRes
			);
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
			const handler = buildResultsStaticMap({
				db,
				logger: mockLogger(),
				nearbyConsulteeRadiusMetres: 20_000,
				rulesetRunner: rulesetRunnerFor(db)
			});
			await handler(
				{
					params: { caseId: realProjectId },
					query: { ruleset: 'england-wales-post-20240430' },
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

	it('should frame the static map on the same search area as the interactive map', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			type: mock.fn(() => mockRes),
			set: mock.fn(() => mockRes),
			send: mock.fn()
		};
		const db = dbReturning([[realProjectRow()], [railwayMatchRow()]]);
		const handler = buildResultsStaticMap(
			{ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000, rulesetRunner: rulesetRunnerFor(db) },
			true
		);
		await handler(
			{ params: { caseId: realProjectId }, query: { ruleset: 'england-wales-post-20240430' }, headers: {} },
			mockRes
		);

		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 200);
		// the display geometry query ran for the static map too
		assert.ok(db.$queryRaw.mock.calls.some((call) => call.arguments[0].join('').includes('AS tolerance')));
	});

	it('should draw only the requested category’s non-excluded matches', async () => {
		// report category pages get their static map from this endpoint, filtered by
		// ?category=…&exclude=… - the display-geometry query's id list is where that filtering shows
		const excludedParishId = '66666666-6666-6666-6666-666666666666';
		const keptParishId = '77777777-7777-7777-7777-777777777777';
		const railwayId = '55555555-5555-5555-5555-555555555555';
		const parishRow = (id: string, consultee: string) => ({
			...railwayMatchRow(),
			id,
			consulteeCategory: 'Parish Council',
			consultee
		});
		const db = dbReturning([
			[realProjectRow()],
			[railwayMatchRow(), parishRow(excludedParishId, 'Excluded Parish'), parishRow(keptParishId, 'Kept Parish')]
		]);
		const handler = buildResultsStaticMap(
			{ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000, rulesetRunner: rulesetRunnerFor(db) },
			true
		);

		const displayGeometryIds = async (query: Record<string, unknown>) => {
			const mockRes = {
				status: mock.fn(() => mockRes),
				type: mock.fn(() => mockRes),
				set: mock.fn(() => mockRes),
				send: mock.fn()
			};
			const callsBefore = db.$queryRaw.mock.callCount();
			await handler({ params: { caseId: realProjectId }, query, headers: {} }, mockRes);
			assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 200);
			// Prisma.join nests the id list inside a Sql param, so stringify the args
			const displayCall = db.$queryRaw.mock.calls
				.slice(callsBefore)
				.find((call) => String(call.arguments[0].join('')).includes('AS tolerance'));
			return displayCall ? JSON.stringify(displayCall.arguments.slice(1)) : '[]';
		};

		// a category page's map: the kept parish is drawn, the excluded parish and the
		// out-of-category railway are not
		const withCategory = await displayGeometryIds({
			ruleset: 'england-wales-post-20240430',
			category: 'Parish Council',
			exclude: excludedParishId
		});
		assert.ok(withCategory.includes(keptParishId));
		assert.ok(!withCategory.includes(excludedParishId));
		assert.ok(!withCategory.includes(railwayId));

		// no category: exclusions still apply to the matches layer (the "all nearby" context layer
		// is unaffected) - an exclusion that removes a match changes the map's fingerprint
		const etag = async (query: Record<string, unknown>) => {
			const mockRes = {
				status: mock.fn(() => mockRes),
				type: mock.fn(() => mockRes),
				set: mock.fn(() => mockRes),
				send: mock.fn()
			};
			await handler({ params: { caseId: realProjectId }, query, headers: {} }, mockRes);
			return mockRes.set.mock.calls[0].arguments[0].ETag;
		};
		const unfiltered = await etag({ ruleset: 'england-wales-post-20240430' });
		const excludingAMatch = await etag({ ruleset: 'england-wales-post-20240430', exclude: excludedParishId });
		const excludingNothing = await etag({
			ruleset: 'england-wales-post-20240430',
			exclude: '88888888-8888-8888-8888-888888888888'
		});
		assert.notStrictEqual(unfiltered, excludingAMatch);
		assert.strictEqual(unfiltered, excludingNothing);
	});

	it('should draw the nearby consultees added by hand (`include`) as identified', async () => {
		// a filled area, so its fill opacity shows - wider than the point site's search area, so regional
		const nearbyRow = {
			...railwayMatchRow(),
			geometryWkt: 'POLYGON((-1.51 52.49, -1.49 52.49, -1.49 52.51, -1.51 52.51, -1.51 52.49))',
			reasons: [{ type: 'nearby' as const, radiusMetres: 20_000 }]
		};
		const svg = async (query: Record<string, unknown>) => {
			const db = dbReturning([[realProjectRow()], [nearbyRow]]);
			const handler = buildResultsStaticMap(
				{ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000, rulesetRunner: rulesetRunnerFor(db) },
				true
			);
			const mockRes = {
				status: mock.fn(() => mockRes),
				type: mock.fn(() => mockRes),
				set: mock.fn(() => mockRes),
				send: mock.fn()
			};
			await handler({ params: { caseId: realProjectId }, query, headers: {} }, mockRes);
			return String(mockRes.send.mock.calls[0].arguments[0]);
		};
		const query = { ruleset: 'england-wales-post-20240430', category: 'Railway' };

		assert.match(await svg(query), new RegExp(`fill-opacity="${NEARBY_REGIONAL_FILL_OPACITY}"`));
		assert.match(await svg({ ...query, include: nearbyRow.id }), new RegExp(`fill-opacity="${REGIONAL_FILL_OPACITY}"`));
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
		const handler = buildResultsStaticMap(
			{ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000, rulesetRunner: failingRulesetRunner() },
			true
		);
		await handler(
			{ params: { caseId: realProjectId }, query: { ruleset: 'england-wales-post-20240430' }, headers: {} },
			mockRes
		);

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
		await handler({ params: {}, query: { ruleset: 'england-wales-post-20240430' }, headers: {} }, mockRes);
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
		const handler = buildResultsStaticMap(
			{ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000, rulesetRunner: rulesetRunnerFor(db) },
			true
		);
		await handler(
			{ params: { caseId: realProjectId }, query: { ruleset: ['england-wales-post-20240430'] }, headers: {} },
			mockRes
		);
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
		await handler(
			{ params: { caseId: realProjectId }, query: { ruleset: 'england-wales-post-20240430' }, headers: {} },
			mockRes
		);
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
			const handler = buildResultsStaticMap(
				{ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000, rulesetRunner: rulesetRunnerFor(db) },
				true
			);
			await handler(
				{ params: { caseId: realProjectId }, query: { ruleset: 'england-wales-post-20240430' }, headers: {} },
				mockRes
			);
			const etag = mockRes.set.mock.calls[0].arguments[0].ETag;

			mockRes.status.mock.resetCalls();
			mockRes.send.mock.resetCalls();
			mockRes.end.mock.resetCalls();

			const db2 = dbReturning([[realProjectRow()], []]);
			const handler2 = buildResultsStaticMap(
				{ db: db2, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000, rulesetRunner: rulesetRunnerFor(db2) },
				true
			);
			await handler2(
				{
					params: { caseId: realProjectId },
					query: { ruleset: 'england-wales-post-20240430' },
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
