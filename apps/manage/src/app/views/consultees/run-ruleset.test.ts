import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import { RULESETS } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { failingRulesetRunner, rulesetRunnerReturning } from '../../testing/ruleset-runner-stub.ts';
import type { StoredRulesetRun } from './run-ruleset.ts';
import { RULESET_RUN_MAX_AGE_MS, RULESET_RUN_SESSION_FIELD, runRulesetSafely } from './run-ruleset.ts';

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
	metadata: '{"FID":1}',
	geometryWkt: 'POINT(-1.5 52.5)',
	distanceMetres: 120
};

describe('runRulesetSafely', () => {
	it('keeps the run in the session, without geometry or metadata, and reuses it', async () => {
		const runner = rulesetRunnerReturning([MATCH]);
		const store: Record<string, unknown> = {};
		const first = await runRulesetSafely(runner, project(), RULESETS[0], 20_000, mockLogger(), store);

		// this request gets the run as it came - geometry and all
		assert.ok(first.consultees[0].feature.geometry);
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
					consultee: 'Abbey Parish Council',
					region: 'East'
				}
			}
		});

		const second = await runRulesetSafely(runner, project(), RULESETS[0], 20_000, mockLogger(), store);
		assert.equal(runner.mock.callCount(), 1);
		assert.deepStrictEqual(second, { consultees: stored.consultees, failed: false });
	});

	it('runs again for another case or ruleset, keeping only the latest run', async () => {
		const runner = rulesetRunnerReturning([MATCH]);
		const store: Record<string, unknown> = {};
		const otherCase = project('55555555-5555-5555-5555-555555555555');
		await runRulesetSafely(runner, project(), RULESETS[0], 20_000, mockLogger(), store);
		await runRulesetSafely(runner, otherCase, RULESETS[0], 20_000, mockLogger(), store);
		await runRulesetSafely(runner, otherCase, RULESETS[1], 20_000, mockLogger(), store);
		await runRulesetSafely(runner, project(), RULESETS[0], 20_000, mockLogger(), store);

		assert.equal(runner.mock.callCount(), 4);
		assert.equal((store[RULESET_RUN_SESSION_FIELD] as StoredRulesetRun).caseId, project().id);
	});

	it('runs again once the kept run is an hour old', async () => {
		const runner = rulesetRunnerReturning([MATCH]);
		const store: Record<string, unknown> = {};
		await runRulesetSafely(runner, project(), RULESETS[0], 20_000, mockLogger(), store);
		(store[RULESET_RUN_SESSION_FIELD] as StoredRulesetRun).ranAt -= RULESET_RUN_MAX_AGE_MS;
		await runRulesetSafely(runner, project(), RULESETS[0], 20_000, mockLogger(), store);

		assert.equal(runner.mock.callCount(), 2);
	});

	it('runs every time without a session, and keeps nothing when the run fails', async () => {
		const runner = rulesetRunnerReturning([MATCH]);
		await runRulesetSafely(runner, project(), RULESETS[0], 20_000, mockLogger());
		await runRulesetSafely(runner, project(), RULESETS[0], 20_000, mockLogger());
		assert.equal(runner.mock.callCount(), 2);

		const store: Record<string, unknown> = {};
		const logger = mockLogger();
		const failed = await runRulesetSafely(failingRulesetRunner(), project(), RULESETS[0], 20_000, logger, store);
		assert.deepStrictEqual(failed, { consultees: [], failed: true });
		assert.equal(store[RULESET_RUN_SESSION_FIELD], undefined);
		assert.equal((logger.error as ReturnType<typeof mock.fn>).mock.callCount(), 1);
	});
});
