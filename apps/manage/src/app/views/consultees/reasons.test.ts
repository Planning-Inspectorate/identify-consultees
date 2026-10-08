import type { ConsulteeMatch, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeReason, describeReasons } from './reasons.ts';

const ruleset: Ruleset = {
	id: 'r',
	name: 'R',
	rules: [
		{ id: 'hospital', name: 'Hospitals', logicType: 'intersection', categories: ['Hospital'], bufferMetres: 10_000 },
		{ id: 'fire', name: 'Fire and Rescue', logicType: 'intersection', categories: ['Fire'], bufferMetres: 500 },
		{ id: 'host', name: 'Host councils', logicType: 'intersection', categories: ['Council'], bufferMetres: 0 },
		// no buffer at all means the same as 0: it must touch the site
		{ id: 'onr', name: 'ONR sites', logicType: 'intersection', categories: ['ONR Site'] },
		{
			id: 'bordering',
			name: '"A" parishes bordering "B" host parishes',
			logicType: 'bordering',
			categories: ['Parish Council'],
			hostCategory: 'Parish Council'
		}
	]
};

describe('describeReason', () => {
	for (const [conditionId, expected] of [
		['hospital', 'Hospitals: within 10km of the site'],
		['fire', 'Fire and Rescue: within 0.5km of the site'],
		['host', 'Host councils: intersects the site'],
		['onr', 'ONR sites: intersects the site'],
		['bordering', '"A" parishes bordering "B" host parishes'],
		['not-in-this-ruleset', 'not-in-this-ruleset']
	]) {
		it(`describes the ${conditionId} condition`, () => {
			assert.equal(describeReason({ type: 'condition', conditionId }, ruleset), expected);
		});
	}

	it('describes the general nearby search', () => {
		assert.equal(describeReason({ type: 'nearby', radiusMetres: 20_000 }, ruleset), 'Within 20km of the site');
	});
});

describe('describeReasons', () => {
	it('keeps the order the run gave and drops repeated text', () => {
		const match: ConsulteeMatch = {
			feature: { id: 'a', properties: {} },
			distanceMetres: 0,
			reasons: [
				{ type: 'condition', conditionId: 'host' },
				{ type: 'nearby', radiusMetres: 20_000 },
				{ type: 'nearby', radiusMetres: 20_000 }
			]
		};
		assert.deepEqual(describeReasons(match, ruleset), [
			'Host councils: intersects the site',
			'Within 20km of the site'
		]);
	});
});
