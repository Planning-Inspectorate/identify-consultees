import type { Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { buildDatabaseRulesetRunner, failingRulesetRunner, rulesetRunnerReturning } from './ruleset-runner-stub.ts';

const site = { type: 'Point' as const, coordinates: [0, 0] as [number, number] };
const emptyRuleset: Ruleset = { id: 'r', name: 'R', rules: [] };

function row(id: string, consulteeCategory: string | null, distanceMetres: number) {
	return { id, consulteeCategory, consultee: id, region: null, geometryWkt: 'POINT(0 0)', distanceMetres };
}

describe('rulesetRunnerReturning', () => {
	it('fills in the optional columns a fixture row leaves out', async () => {
		const { matches, allNearby } = await rulesetRunnerReturning([row('a', 'Hospital', 5)])(site, emptyRuleset, 1);

		assert.deepEqual(matches[0].feature.properties, {
			consulteeCategory: 'Hospital',
			consultee: 'a',
			region: null,
			caseReference: null,
			documentId: null,
			consulteeId: null,
			organisationId: null,
			currentVersion: 1,
			metadata: {}
		});
		assert.equal('geometry' in allNearby[0].feature, false);
	});
});

describe('failingRulesetRunner', () => {
	it('rejects like an unreachable function', async () => {
		await assert.rejects(() => failingRulesetRunner()(site, emptyRuleset, 1), /status 500/);
	});
});

describe('buildDatabaseRulesetRunner', () => {
	it('matches intersection conditions by category and buffer, and lists everything in the radius', async () => {
		const rows = [
			row('police', 'Police', 0),
			row('hospital', 'Hospital', 900),
			row('far-hospital', 'Hospital', 1_500),
			row('none', null, 0)
		];
		const db = { $queryRaw: mock.fn(async () => rows) };
		const ruleset: Ruleset = {
			id: 'r',
			name: 'R',
			rules: [
				{ id: 'h', name: 'Hospitals', logicType: 'intersection', categories: ['Hospital'], bufferMetres: 1_000 },
				// no buffer means it must touch the site
				{ id: 'touching', name: 'Touching', logicType: 'intersection', categories: ['Police'] },
				{
					id: 'b',
					name: 'Bordering',
					logicType: 'bordering',
					categories: ['Parish Council'],
					hostCategory: 'Parish Council'
				}
			]
		};

		const run = buildDatabaseRulesetRunner(() => db as never);
		const { matches, allNearby } = await run(site, ruleset, 1_200);

		assert.deepEqual(
			matches.map((match) => match.feature.id),
			['police', 'hospital']
		);
		assert.deepEqual(
			allNearby.map((match) => match.feature.id),
			['police', 'hospital', 'none']
		);
	});
});
