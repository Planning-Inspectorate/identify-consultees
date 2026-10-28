import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import { RULESETS } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { failingRulesetRunner, rulesetRunnerReturning } from '../../testing/ruleset-runner-stub.ts';
import { NEARBY_NSIPS } from './nearby-nsips.ts';
import type { RulesetRunService, StoredRulesetRun } from './run-ruleset.ts';
import {
	buildSearchAreaSafely,
	RULESET_RUN_MAX_AGE_MS,
	RULESET_RUN_SESSION_FIELD,
	runRulesetSafely
} from './run-ruleset.ts';
import { TEST_FAULT_SESSION_FIELD } from './test-faults.ts';

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
	consulteeCategory: 'Parish Council',
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
		...extra
	} as RulesetRunService;
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
					consulteeCategory: 'Parish Council',
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

	it('fails the run while the test-fail=ruleset fault is set - over a kept run, and never kept', async () => {
		const runner = rulesetRunnerReturning([MATCH]);
		const store: Record<string, unknown> = { [TEST_FAULT_SESSION_FIELD]: 'ruleset' };
		const enabled = serviceWith(runner, mockLogger(), { testFaultsEnabled: true });
		const disabled = serviceWith(runner, mockLogger(), { testFaultsEnabled: false });

		// while set: the run fails without the function being called, and nothing is kept
		assert.deepStrictEqual(await runRulesetSafely(enabled, project(), RULESETS[0], store), {
			consultees: [],
			failed: true,
			siteScreenedAs: 'outline'
		});
		assert.equal(runner.mock.callCount(), 0);
		assert.equal(store[RULESET_RUN_SESSION_FIELD], undefined);

		// a real run goes into the session as normal once the flag is off
		assert.equal((await runRulesetSafely(disabled, project(), RULESETS[0], store)).failed, false);
		assert.equal(runner.mock.callCount(), 1);

		// the fault still fails, over the run the session just kept
		assert.equal((await runRulesetSafely(enabled, project(), RULESETS[0], store)).failed, true);
		assert.equal(runner.mock.callCount(), 1);

		// and clearing it serves the kept run without calling the function again
		delete store[TEST_FAULT_SESSION_FIELD];
		assert.equal((await runRulesetSafely(enabled, project(), RULESETS[0], store)).failed, false);
		assert.equal(runner.mock.callCount(), 1);
	});

	it('screens the boundary as stored simplified, where the case was read with it', async () => {
		const simplifiedGeometry = { type: 'Point' as const, coordinates: [-1.4, 52.4] as [number, number] };
		const runner = rulesetRunnerReturning([]);
		await runRulesetSafely(serviceWith(runner), { ...project(), simplifiedGeometry }, RULESETS[0]);
		await runRulesetSafely(serviceWith(runner), project(), RULESETS[0]);

		assert.deepStrictEqual(runner.mock.calls[0].arguments[0], simplifiedGeometry);
		assert.deepStrictEqual(runner.mock.calls[1].arguments[0], project().geometry);
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
			['Parish Council', NEARBY_NSIPS]
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
		feature: { id: MATCH.id, properties: { consulteeCategory: 'Parish Council' } },
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
