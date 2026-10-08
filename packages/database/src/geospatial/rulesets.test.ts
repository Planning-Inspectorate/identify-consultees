import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildRulesetFromCsv, getRuleset, parseRulesetCsv, RULESETS } from './rulesets.ts';

// running a ruleset is the Python function's job now - see apps/function-python/querying/test_rulesets.py

describe('parseRulesetCsv', () => {
	const header =
		'consulteeName\treferenceData\tconsulteeDescription\tmatchingConsulteeType\thostType\tlogicDescription\tlogicType\tintersectionBufferKm';

	test('resolves the matching category from referenceData when set', () => {
		const [rule] = parseRulesetCsv(`${header}\nrailway\trail_epsg27700\tRailways\t\t\tIntersects\tintersection\t10`);
		assert.deepEqual(rule, {
			id: 'railway',
			name: 'Railways',
			logicType: 'intersection',
			categories: ['Railway'],
			bufferMetres: 10000
		});
	});

	test('falls back to matchingConsulteeType (splitting on ";"), then consulteeName', () => {
		const [withType] = parseRulesetCsv(
			`${header}\nb_host\t\tHost\tparish; unitary_auth\t\tIntersects\tintersection\t0`
		);
		assert.deepEqual(withType.categories, ['Parish Council', 'Unitary Authority']);

		const [bareName] = parseRulesetCsv(`${header}\nhospital\t\tHospitals\t\t\tIntersects\tintersection\t10`);
		assert.deepEqual(bareName.categories, ['Hospital']);
	});

	test('parses a bordering rule with a host category', () => {
		const [rule] = parseRulesetCsv(
			`${header}\na_bordering_b\t\tBordering\tparish\tparish\tBordering host authority\tbordering\t0`
		);
		assert.equal(rule.logicType, 'bordering');
		assert.deepEqual(rule.categories, ['Parish Council']);
		assert.equal(rule.hostCategory, 'Parish Council');
		assert.equal(rule.bufferMetres, undefined);
	});

	test('passes through an unmapped identifier unchanged rather than dropping it', () => {
		const [rule] = parseRulesetCsv(`${header}\ncanal\tcanals_epsg27700\tCanals\t\t\tIntersects\tintersection\t10`);
		// no reference data has this category loaded yet - the condition still exists, it just
		// won't match anything until it does
		assert.deepEqual(rule.categories, ['canals_epsg27700']);
	});

	test('throws on a CSV missing an expected column', () => {
		assert.throws(() => parseRulesetCsv('a\tb\tc\n1\t2\t3'), /missing expected column/);
	});
});

describe('buildRulesetFromCsv', () => {
	const header =
		'consulteeName\treferenceData\tconsulteeDescription\tmatchingConsulteeType\thostType\tlogicDescription\tlogicType\tintersectionBufferKm';

	test('wraps every row of a CSV export as one ruleset', () => {
		const ruleset = buildRulesetFromCsv(
			'test-ruleset',
			'Test ruleset',
			`${header}\nrailway\trail_epsg27700\tRailways\t\t\tIntersects\tintersection\t10\nhospital\t\tHospitals\t\t\tIntersects\tintersection\t10`
		);
		assert.equal(ruleset.id, 'test-ruleset');
		assert.equal(ruleset.name, 'Test ruleset');
		assert.equal(ruleset.rules.length, 2);
		assert.deepEqual(
			ruleset.rules.map((rule) => rule.id),
			['railway', 'hospital']
		);
	});
});

describe('rulesets registry', () => {
	test('loads exactly the one real ruleset from the sample data export, with its conditions', () => {
		assert.equal(RULESETS.length, 1);
		const [ruleset] = RULESETS;
		assert.ok(ruleset.id && ruleset.name);
		assert.ok(ruleset.rules.length > 1, 'expected the real export to contain more than one condition');
	});

	test('getRuleset finds a known ruleset by id and returns undefined for an unknown one', () => {
		const ruleset = getRuleset('example-ruleset');
		assert.ok(ruleset);
		assert.equal(getRuleset('not-a-real-ruleset'), undefined);
	});
});
