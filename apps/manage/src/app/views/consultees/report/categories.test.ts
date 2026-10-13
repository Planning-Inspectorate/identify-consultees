import type { ConsulteeMatch, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { reportCategories, rulesetCategories } from './categories.ts';

const ruleset: Ruleset = {
	id: 'test',
	name: 'Test',
	rules: [
		{ id: 'parish', name: 'Parishes', logicType: 'intersection', categories: ['Parish Council'], bufferMetres: 0 },
		{ id: 'rail', name: 'Railways', logicType: 'intersection', categories: ['Railway'], bufferMetres: 10_000 },
		{ id: 'parish_again', name: 'Parishes', logicType: 'intersection', categories: ['Parish Council'], bufferMetres: 1 }
	]
};

function match(consulteeCategory: string | null): ConsulteeMatch {
	return {
		feature: { id: String(consulteeCategory), properties: { consulteeCategory } },
		distanceMetres: 0,
		reasons: [{ type: 'condition', conditionId: 'rail' }]
	} as ConsulteeMatch;
}

describe('report categories', () => {
	it("lists the ruleset's categories once each, in rule order", () => {
		assert.deepStrictEqual(rulesetCategories(ruleset), ['Parish Council', 'Railway']);
	});

	it('adds any other category a match is in, alphabetically, after the ruleset ones', () => {
		// SQL compares categories case-insensitively, so a condition on "Railway" also matches data
		// categorised "railway" - which then isn't one of the ruleset's own names
		assert.deepStrictEqual(
			reportCategories(ruleset, [match('railway'), match('Parish Council'), match('Hospital'), match(null)]),
			['Parish Council', 'Railway', 'Hospital', 'railway']
		);
	});
});
