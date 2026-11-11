import type { ConsulteeMatch, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { categoryDisplayName, reportCategories, rulesetCategories } from './categories.ts';

const ruleset: Ruleset = {
	id: 'test',
	name: 'Test',
	rules: [
		{
			id: 'parish',
			name: 'Parishes',
			logicType: 'intersection',
			categories: ['Parish, town and community councils'],
			bufferMetres: 0
		},
		{ id: 'rail', name: 'Railways', logicType: 'intersection', categories: ['Railways'], bufferMetres: 10_000 },
		{
			id: 'parish_again',
			name: 'Parishes',
			logicType: 'intersection',
			categories: ['Parish, town and community councils'],
			bufferMetres: 1
		}
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
	it('spells out NSIPs wherever a page names the category - every other is its own name', () => {
		assert.strictEqual(categoryDisplayName('NSIPs'), 'National infrastructure projects');
		assert.strictEqual(
			categoryDisplayName('Parish, town and community councils'),
			'Parish, town and community councils'
		);
	});

	it("lists the ruleset's categories once each, in rule order", () => {
		assert.deepStrictEqual(rulesetCategories(ruleset), ['Parish, town and community councils', 'Railways']);
	});

	it('adds any other category a match is in, alphabetically, after the ruleset ones', () => {
		// SQL compares categories case-insensitively, so a condition on "Railways" also matches data
		// categorised "railway" - which then isn't one of the ruleset's own names
		assert.deepStrictEqual(
			reportCategories(ruleset, [
				match('railway'),
				match('Parish, town and community councils'),
				match('Hospitals operated by NHS trusts and NHS foundation trusts (England)'),
				match(null)
			]),
			[
				'Parish, town and community councils',
				'Railways',
				'Hospitals operated by NHS trusts and NHS foundation trusts (England)',
				'railway'
			]
		);
	});
});
