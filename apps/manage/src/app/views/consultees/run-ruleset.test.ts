import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import { RULESETS } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { failingRulesetRunner, rulesetRunnerReturning } from '../../testing/ruleset-runner-stub.ts';
import { NEARBY_NSIPS } from './nearby-nsips.ts';
import type { RulesetRunService, StoredRulesetRun, StoredRunReference } from './run-ruleset.ts';
import {
	buildSearchAreaSafely,
	RULESET_RUN_MAX_AGE_MS,
	RULESET_RUN_SESSION_FIELD,
	runRulesetSafely
} from './run-ruleset.ts';

function project(id = '44444444-4444-4444-4444-444444444444'): CaseBoundaryFeature {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'Point', coordinates: [-1.5, 52.5] },
		properties: { caseReference: 'EN010099', caseName: 'Real Test Project' }
	} as CaseBoundaryFeature;
}

const MATCH = {
	id: 'aaaaaaaa-0000-0000-0000-000000000001',
	consulteeCategory: 'Parish, town and community councils',
	consultee: 'Abbey Parish Council',
	region: 'East',
	distanceMetres: 120
};

/** The service a run needs: `runner` for the Python function, and `db` for any Nearby NSIPs. */
function serviceWith(
	runner: RulesetRunService['rulesetRunner'],
	logger = mockLogger(),
	extra: Partial<RulesetRunService> = {}
): RulesetRunService {
	return {
		db: {} as RulesetRunService['db'],
		logger,
		rulesetRunner: runner,
		nearbyConsulteeRadiusMetres: 20_000,
		redisPrefix: 'manage:',
		...extra
	} as RulesetRunService;
}

/**
 * A stand-in Redis shaped like core's client: `fullClient` serves `get`/`setEx` - enough of it for
 * the run key. Core's RedisClient copies the real client's get/set unbound onto the wrapper, and
 * calling one there throws against a real cluster - so the wrapper's `get` throws here too, and
 * any read that doesn't go through `fullClient` fails the test.
 */
function fakeRedis(
	overrides: { get?: (key: string) => Promise<string | null>; setEx?: (...args: unknown[]) => Promise<void> } = {}
) {
	const data = new Map<string, string>();
	const setEx = mock.fn(
		overrides.setEx ??
			(async (key: string, _ttl: number, value: string) => {
				data.set(key, value);
			})
	);
	const get = mock.fn(overrides.get ?? (async (key: string) => data.get(key) ?? null));
	const client = {
		get: mock.fn(async () => {
			throw new Error("the wrapper's unbound get - read through fullClient");
		}),
		fullClient: { get, setEx }
	};
	return { data, get, setEx, client: client as unknown as NonNullable<RulesetRunService['redisClient']> };
}

const NEARBY_CASE = {
	id: 'BBBBBBBB-0000-0000-0000-000000000002',
	caseReference: 'EN010200',
	caseName: 'Neighbouring Solar Farm',
	fileName: 'neighbour.geojson',
	receivedDate: new Date('2026-09-01T09:00:00Z'),
	distanceMetres: 2_345
};

describe('runRulesetSafely', () => {
	it('keeps the run in the session, and reuses it', async () => {
		const runner = rulesetRunnerReturning([MATCH]);
		const store: Record<string, unknown> = {};
		const first = await runRulesetSafely(serviceWith(runner), project(), RULESETS[0], store);

		const stored = store[RULESET_RUN_SESSION_FIELD] as StoredRulesetRun;
		assert.equal(stored.caseId, project().id);
		assert.equal(stored.rulesetId, RULESETS[0].id);
		assert.deepStrictEqual(stored.consultees[0], {
			distanceMetres: 120,
			reasons: [{ type: 'condition', conditionId: 'test-condition' }],
			feature: {
				id: MATCH.id,
				properties: {
					sourceId: null,
					consulteeCategory: 'Parish, town and community councils',
					consulteeGroup: null,
					consulteeSubcategory: null,
					consulteeSubcategoryDescription: null,
					consultee: 'Abbey Parish Council',
					region: 'East'
				}
			}
		});

		const second = await runRulesetSafely(serviceWith(runner), project(), RULESETS[0], store);
		assert.equal(runner.mock.callCount(), 1);
		assert.deepStrictEqual(second, { consultees: stored.consultees, failed: false, siteScreenedAs: 'outline' });
	});

	it("keeps the run under the session's own Redis key, the session holding only the pointer", async () => {
		const runner = rulesetRunnerReturning([MATCH]);
		const redis = fakeRedis();
		const store: Record<string, unknown> = { id: 'a-session' };
		const svc = serviceWith(runner, mockLogger(), { redisClient: redis.client });

		const first = await runRulesetSafely(svc, project(), RULESETS[0], store);
		const pointer = store[RULESET_RUN_SESSION_FIELD] as StoredRunReference;
		assert.deepStrictEqual(pointer, { caseId: project().id, rulesetId: RULESETS[0].id, ranAt: pointer.ranAt });
		const kept = JSON.parse(redis.data.get('manage:rulesetRun:a-session') ?? 'null') as StoredRulesetRun;
		assert.equal(kept.caseId, project().id);
		assert.equal(kept.consultees.length, 1);
		assert.equal(redis.setEx.mock.callCount(), 1);
		assert.equal(redis.setEx.mock.calls[0].arguments[1], Math.ceil(RULESET_RUN_MAX_AGE_MS / 1000));

		const second = await runRulesetSafely(svc, project(), RULESETS[0], store);
		assert.equal(runner.mock.callCount(), 1);
		assert.deepStrictEqual(second, first);
	});

	it("runs again when the session's pointer has no run behind it, or Redis is gone", async () => {
		const pointer = { caseId: project().id, rulesetId: RULESETS[0].id, ranAt: Date.now() };
		const cases: [RulesetRunService, Record<string, unknown>][] = [
			// no Redis at all
			[serviceWith(rulesetRunnerReturning([MATCH])), { id: 'a-session', [RULESET_RUN_SESSION_FIELD]: pointer }],
			// Redis, but nothing under the key
			[
				serviceWith(rulesetRunnerReturning([MATCH]), mockLogger(), { redisClient: fakeRedis().client }),
				{ id: 'a-session', [RULESET_RUN_SESSION_FIELD]: pointer }
			],
			// a store with no session id keys nothing
			[
				serviceWith(rulesetRunnerReturning([MATCH]), mockLogger(), { redisClient: fakeRedis().client }),
				{ [RULESET_RUN_SESSION_FIELD]: pointer }
			]
		];
		for (const [svc, store] of cases) {
			await runRulesetSafely(svc, project(), RULESETS[0], store);
			assert.equal((svc.rulesetRunner as ReturnType<typeof mock.fn>).mock.callCount(), 1);
		}
	});

	it("runs again when the key holds another run's - one a reissued session id left behind", async () => {
		const runner = rulesetRunnerReturning([MATCH]);
		const redis = fakeRedis();
		redis.data.set(
			'manage:rulesetRun:a-session',
			JSON.stringify({ caseId: project().id, rulesetId: RULESETS[0].id, ranAt: Date.now() - 1, consultees: [] })
		);
		const store: Record<string, unknown> = {
			id: 'a-session',
			[RULESET_RUN_SESSION_FIELD]: { caseId: project().id, rulesetId: RULESETS[0].id, ranAt: Date.now() }
		};
		await runRulesetSafely(
			serviceWith(runner, mockLogger(), { redisClient: redis.client }),
			project(),
			RULESETS[0],
			store
		);
		assert.equal(runner.mock.callCount(), 1);
	});

	it('runs again when reading the run from Redis fails, and says so', async () => {
		const runner = rulesetRunnerReturning([MATCH]);
		const logger = mockLogger();
		const redis = fakeRedis({
			get: async () => {
				throw new Error('redis down');
			}
		});
		const store: Record<string, unknown> = {
			id: 'a-session',
			[RULESET_RUN_SESSION_FIELD]: { caseId: project().id, rulesetId: RULESETS[0].id, ranAt: Date.now() }
		};
		await runRulesetSafely(serviceWith(runner, logger, { redisClient: redis.client }), project(), RULESETS[0], store);
		assert.equal(runner.mock.callCount(), 1);
		assert.equal((logger.warn as ReturnType<typeof mock.fn>).mock.callCount(), 1);
	});

	it("keeps the run in the session when Redis can't be written, and says so", async () => {
		const runner = rulesetRunnerReturning([MATCH]);
		const logger = mockLogger();
		const redis = fakeRedis({
			setEx: async () => {
				throw new Error('redis down');
			}
		});
		const store: Record<string, unknown> = { id: 'a-session' };
		await runRulesetSafely(serviceWith(runner, logger, { redisClient: redis.client }), project(), RULESETS[0], store);
		assert.equal((logger.warn as ReturnType<typeof mock.fn>).mock.callCount(), 1);
		const stored = store[RULESET_RUN_SESSION_FIELD] as StoredRulesetRun;
		assert.equal(stored.consultees.length, 1);
	});

	it('runs again for another case or ruleset, keeping only the latest run', async () => {
		const runner = rulesetRunnerReturning([MATCH]);
		const store: Record<string, unknown> = {};
		const otherCase = project('55555555-5555-5555-5555-555555555555');
		await runRulesetSafely(serviceWith(runner), project(), RULESETS[0], store);
		await runRulesetSafely(serviceWith(runner), otherCase, RULESETS[0], store);
		await runRulesetSafely(serviceWith(runner), otherCase, RULESETS[1], store);
		await runRulesetSafely(serviceWith(runner), project(), RULESETS[0], store);

		assert.equal(runner.mock.callCount(), 4);
		assert.equal((store[RULESET_RUN_SESSION_FIELD] as StoredRulesetRun).caseId, project().id);
	});

	it('runs again once the kept run is an hour old', async () => {
		const runner = rulesetRunnerReturning([MATCH]);
		const store: Record<string, unknown> = {};
		await runRulesetSafely(serviceWith(runner), project(), RULESETS[0], store);
		(store[RULESET_RUN_SESSION_FIELD] as StoredRulesetRun).ranAt -= RULESET_RUN_MAX_AGE_MS;
		await runRulesetSafely(serviceWith(runner), project(), RULESETS[0], store);

		assert.equal(runner.mock.callCount(), 2);
	});

	it('runs every time without a session, and keeps nothing when the run fails', async () => {
		const runner = rulesetRunnerReturning([MATCH]);
		await runRulesetSafely(serviceWith(runner), project(), RULESETS[0]);
		await runRulesetSafely(serviceWith(runner), project(), RULESETS[0]);
		assert.equal(runner.mock.callCount(), 2);

		const store: Record<string, unknown> = {};
		const logger = mockLogger();
		const failing = failingRulesetRunner();
		const failed = await runRulesetSafely(serviceWith(failing, logger), project(), RULESETS[0], store);
		assert.deepStrictEqual(failed, { consultees: [], failed: true, siteScreenedAs: 'outline' });
		assert.equal(store[RULESET_RUN_SESSION_FIELD], undefined);
		// once - not again on the bounding box, adding its queries to a struggling database
		assert.equal(failing.mock.callCount(), 1);
		assert.equal((logger.error as ReturnType<typeof mock.fn>).mock.callCount(), 1);
	});

	it('screens the boundary as stored simplified, where the case was read with it', async () => {
		const simplifiedGeometry = { type: 'Point' as const, coordinates: [-1.4, 52.4] as [number, number] };
		const runner = rulesetRunnerReturning([]);
		await runRulesetSafely(serviceWith(runner), { ...project(), simplifiedGeometry }, RULESETS[0]);
		await runRulesetSafely(serviceWith(runner), project(), RULESETS[0]);

		assert.deepStrictEqual(runner.mock.calls[0].arguments[0], simplifiedGeometry);
		assert.deepStrictEqual(runner.mock.calls[1].arguments[0], project().geometry);
		// and names the case boundary, whose actual boundary the function checks hosts against
		assert.equal(runner.mock.calls[0].arguments[3], project().id);
	});

	it('takes what the function screened - its bounding box, for a site past the limit - and reads an older kept run as the outline', async () => {
		const runner = mock.fn(async () => ({ consultees: [], siteScreenedAs: 'boundingBox' as const }));
		const store: Record<string, unknown> = {};
		assert.equal(
			(await runRulesetSafely(serviceWith(runner as never), project(), RULESETS[0], store)).siteScreenedAs,
			'boundingBox'
		);
		delete (store[RULESET_RUN_SESSION_FIELD] as StoredRulesetRun).siteScreenedAs;
		assert.equal(
			(await runRulesetSafely(serviceWith(runner as never), project(), RULESETS[0], store)).siteScreenedAs,
			'outline'
		);
		// a runner that doesn't say means the outline
		const silent = mock.fn(async () => ({ consultees: [] }));
		assert.equal(
			(await runRulesetSafely(serviceWith(silent as never), project(), RULESETS[0])).siteScreenedAs,
			'outline'
		);
	});

	it('adds the cases near the site as Nearby NSIPs, with the radius the query used', async () => {
		const $queryRaw = mock.fn(async (..._args: unknown[]) => [NEARBY_CASE]);
		const service = serviceWith(rulesetRunnerReturning([MATCH]), mockLogger(), {
			db: { $queryRaw } as unknown as RulesetRunService['db'],
			nearbyNsipRadiusMetres: 10_000
		});
		const store: Record<string, unknown> = {};
		const { consultees, failed } = await runRulesetSafely(service, project(), RULESETS[0], store);

		assert.equal(failed, false);
		assert.deepStrictEqual(
			consultees.map((match) => match.feature.properties.consulteeCategory),
			['Parish, town and community councils', NEARBY_NSIPS]
		);
		assert.deepStrictEqual(consultees[1], {
			feature: {
				id: 'bbbbbbbb-0000-0000-0000-000000000002',
				properties: {
					sourceId: 'EN010200',
					consulteeCategory: NEARBY_NSIPS,
					consulteeGroup: NEARBY_NSIPS,
					consultee: 'Neighbouring Solar Farm (EN010200)',
					region: null
				}
			},
			distanceMetres: 2_345,
			reasons: [{ type: 'nearbyNsip', radiusMetres: 10_000 }]
		});
		// looked up by the site's own boundary id, within the radius
		const values = $queryRaw.mock.calls[0].arguments.slice(1);
		assert.ok(values.includes(project().id) && values.includes(10_000));
		// kept with the run, like any other consultee
		assert.equal((store[RULESET_RUN_SESSION_FIELD] as StoredRulesetRun).consultees.length, 2);
	});

	it('looks for no Nearby NSIPs when their distance is 0', async () => {
		const $queryRaw = mock.fn(async () => [NEARBY_CASE]);
		const service = serviceWith(rulesetRunnerReturning([MATCH]), mockLogger(), {
			db: { $queryRaw } as unknown as RulesetRunService['db'],
			nearbyNsipRadiusMetres: 0
		});
		const { consultees } = await runRulesetSafely(service, project(), RULESETS[0]);
		assert.equal(consultees.length, 1);
		assert.equal($queryRaw.mock.callCount(), 0);
	});

	it("fails the run when the Nearby NSIPs can't be found, rather than show none", async () => {
		const logger = mockLogger();
		const service = serviceWith(rulesetRunnerReturning([MATCH]), logger, {
			db: {
				$queryRaw: mock.fn(async () => {
					throw new Error('database unavailable');
				})
			} as unknown as RulesetRunService['db'],
			nearbyNsipRadiusMetres: 10_000
		});
		const store: Record<string, unknown> = {};
		assert.deepStrictEqual(await runRulesetSafely(service, project(), RULESETS[0], store), {
			consultees: [],
			failed: true,
			siteScreenedAs: 'outline'
		});
		assert.equal(store[RULESET_RUN_SESSION_FIELD], undefined);
		assert.equal((logger.error as ReturnType<typeof mock.fn>).mock.callCount(), 1);
	});
});

describe('buildSearchAreaSafely', () => {
	const nsip = {
		feature: { id: 'bbbbbbbb-0000-0000-0000-000000000002', properties: { consulteeCategory: NEARBY_NSIPS } },
		distanceMetres: 0,
		reasons: [{ type: 'nearbyNsip' as const, radiusMetres: 10_000 }]
	};
	const parish = {
		feature: { id: MATCH.id, properties: { consulteeCategory: 'Parish, town and community councils' } },
		distanceMetres: 0,
		reasons: [{ type: 'condition' as const, conditionId: 'test-condition' }]
	};

	it("draws consultee areas from consultee_area, and Nearby NSIPs from their case's boundary", async () => {
		const $queryRaw = mock.fn(async (sql: TemplateStringsArray) => {
			const text = sql.join('');
			if (!/\bFROM\b/.test(text)) return [{ wkt: 'POINT(-1.5 52.5)' }];
			if (text.includes('FROM consultee_area')) return [{ id: MATCH.id, geometryWkt: 'POINT(-1.4 52.5)' }];
			return [{ id: nsip.feature.id.toUpperCase(), geometryWkt: 'POINT(-1.3 52.5)' }];
		});
		const searchArea = await buildSearchAreaSafely(
			{ $queryRaw } as unknown as RulesetRunService['db'],
			project(),
			[parish, nsip],
			20_000,
			mockLogger()
		);
		assert.deepStrictEqual(Object.fromEntries(searchArea!.geometries), {
			[MATCH.id]: { type: 'Point', coordinates: [-1.4, 52.5] },
			[nsip.feature.id]: { type: 'Point', coordinates: [-1.3, 52.5] }
		});
		// one query each - the buffer, consultee_area, case_boundary
		assert.equal($queryRaw.mock.callCount(), 3);
	});

	/** Each display-geometry query's table, and whether it was limited to the search area (a nested SQL fragment), with its ids. */
	async function displayQueries(matches: Parameters<typeof buildSearchAreaSafely>[2]) {
		const queries: { table: string; windowed: boolean; ids: string[] }[] = [];
		const $queryRaw = mock.fn(async (sql: TemplateStringsArray, ...values: unknown[]) => {
			const text = sql.join('');
			if (!/\bFROM\b/.test(text)) return [{ wkt: 'POINT(-1.5 52.5)' }];
			queries.push({
				table: text.includes('FROM consultee_area') ? 'consultee_area' : 'case_boundary',
				windowed: values.some((value) => String((value as { sql?: string })?.sql).includes('STIntersects')),
				ids: values
					.flatMap((value) => (value as { values?: unknown[] })?.values ?? [])
					.map(String)
					.filter((v) => /^[0-9a-f-]{36}$/.test(v))
					.sort()
			});
			return [];
		});
		await buildSearchAreaSafely(
			{ $queryRaw } as unknown as RulesetRunService['db'],
			project(),
			matches,
			20_000,
			mockLogger()
		);
		return queries.toSorted((a, b) => a.table.localeCompare(b.table) || Number(b.windowed) - Number(a.windowed));
	}

	const nearbyParish = {
		feature: {
			id: 'dddddddd-0000-0000-0000-000000000004',
			properties: { consulteeCategory: 'Parish, town and community councils' }
		},
		distanceMetres: 5_000,
		reasons: [{ type: 'nearby' as const, radiusMetres: 20_000 }]
	};

	it('draws a consultee added by hand wherever it is, not only where it touches the search area', async () => {
		const added = { ...nearbyParish, feature: { ...nearbyParish.feature, id: 'cccccccc-0000-0000-0000-000000000003' } };
		assert.deepStrictEqual(
			(await displayQueries([nearbyParish, { ...added, addedByHand: true }, { ...nsip, addedByHand: true }])).map(
				({ table, windowed }) => ({ table, windowed })
			),
			[
				{ table: 'case_boundary', windowed: false },
				{ table: 'consultee_area', windowed: true },
				{ table: 'consultee_area', windowed: false }
			]
		);
	});

	it('draws an identified consultee wherever it is - a district bordering the host authority can be beyond the search', async () => {
		// the parish is identified by a condition, and a Nearby NSIP is listed as identified too;
		// only the consultees drawn as nearby context are limited to the search area
		assert.deepStrictEqual(await displayQueries([parish, nearbyParish, nsip]), [
			{ table: 'case_boundary', windowed: false, ids: [nsip.feature.id] },
			{ table: 'consultee_area', windowed: true, ids: [nearbyParish.feature.id] },
			{ table: 'consultee_area', windowed: false, ids: [parish.feature.id] }
		]);
	});

	it('looks up no case boundaries when there are no Nearby NSIPs', async () => {
		const $queryRaw = mock.fn(async (sql: TemplateStringsArray) =>
			/\bFROM\b/.test(sql.join('')) ? [] : [{ wkt: 'POINT(-1.5 52.5)' }]
		);
		await buildSearchAreaSafely(
			{ $queryRaw } as unknown as RulesetRunService['db'],
			project(),
			[parish],
			20_000,
			mockLogger()
		);
		assert.equal($queryRaw.mock.callCount(), 2);
	});
});
