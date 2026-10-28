import type { ConsulteeMatch, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reportByCategory } from './report-consultees.ts';

const RULESET: Ruleset = {
	id: 'test-ruleset',
	name: 'Test ruleset',
	rules: [
		{
			id: 'parish-host',
			name: 'Parish host',
			group: 'Administrative boundaries',
			logicType: 'intersection',
			categories: ['Parish Council']
		}
	]
};

function match(id: string, consultee: string, category = 'Parish Council'): ConsulteeMatch {
	return {
		feature: {
			id,
			properties: { consulteeCategory: category, consultee },
			geometry: { type: 'Point', coordinates: [-1.5, 52.5] }
		},
		distanceMetres: 0,
		reasons: [{ type: 'condition', conditionId: 'parish-host' }]
	} as ConsulteeMatch;
}

describe('reportByCategory', () => {
	it("lists each category's consultees alphabetically by name, hand-added ones among the matches", () => {
		const [parishes] = reportByCategory(RULESET, [match('a', 'Thorganby'), match('b', 'Cawood')], {
			removed: [],
			adds: [{ category: 'Parish Council', name: 'Gateforth', reason: 'Borders the site' }]
		});
		assert.deepStrictEqual(
			parishes.consultees.map((consultee) => consultee.name),
			['Cawood', 'Gateforth', 'Thorganby']
		);
	});
});
