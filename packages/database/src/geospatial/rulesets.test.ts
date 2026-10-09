import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
	buildRulesetFromCsv,
	getRuleset,
	loadRulesets,
	parseRulesetCsv,
	rulesetIdFromFileName,
	rulesetNameFromFileName,
	RULESETS
} from './rulesets.ts';

// running a ruleset is the Python function's job now - see apps/function-python/intersector/test_screening.py

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

describe('ruleset names from file names', () => {
	test('the id is the file name, kebab-cased, without the _ruleset.csv suffix', () => {
		assert.equal(rulesetIdFromFileName('england_wales_post_20240430_ruleset.csv'), 'england-wales-post-20240430');
		assert.equal(rulesetIdFromFileName('Offshore_Wind_ruleset.csv'), 'offshore-wind');
	});

	test('the display name capitalises words, keeps joining words lower case and writes out dates', () => {
		assert.equal(
			rulesetNameFromFileName('england_wales_post_20240430_ruleset.csv'),
			'England Wales post 30 April 2024'
		);
		assert.equal(
			rulesetNameFromFileName('england_and_wales_pre_20240430_ruleset.csv'),
			'England and Wales pre 30 April 2024'
		);
		// a leading joining word is still capitalised, and an impossible date is left as it is
		assert.equal(rulesetNameFromFileName('post_20241301_ruleset.csv'), 'Post 20241301');
	});
});

describe('loadRulesets', () => {
	const header =
		'consulteeName\treferenceData\tconsulteeDescription\tmatchingConsulteeType\thostType\tlogicDescription\tlogicType\tintersectionBufferKm';
	const row = 'hospital\t\tHospitals\t\t\t\tintersection\t10';

	test('loads every *_ruleset.csv in file-name order, named from the file, and ignores other files', () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'rulesets-'));
		try {
			for (const file of ['wales_ruleset.csv', 'england_post_20240430_ruleset.csv']) {
				writeFileSync(path.join(dir, file), `${header}\n${row}\n`);
			}
			writeFileSync(path.join(dir, 'notes.csv'), 'not a ruleset');

			const rulesets = loadRulesets(dir);

			assert.deepEqual(
				rulesets.map((ruleset) => [ruleset.id, ruleset.name, ruleset.rules.length]),
				[
					['england-post-20240430', 'England post 30 April 2024', 1],
					['wales', 'Wales', 1]
				]
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('fails loudly rather than starting with no rulesets', () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'rulesets-'));
		try {
			assert.throws(() => loadRulesets(dir), /No ruleset exports/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('rulesets registry', () => {
	test('loads exactly the one real ruleset, named from its export, with its conditions', () => {
		assert.equal(RULESETS.length, 1);
		const [ruleset] = RULESETS;
		assert.equal(ruleset.id, 'england-wales-post-20240430');
		assert.equal(ruleset.name, 'England Wales post 30 April 2024');
		assert.ok(ruleset.rules.length > 1, 'expected the real export to contain more than one condition');
	});

	test('getRuleset finds a known ruleset by id and returns undefined for an unknown one', () => {
		const ruleset = getRuleset('england-wales-post-20240430');
		assert.ok(ruleset);
		assert.equal(getRuleset('not-a-real-ruleset'), undefined);
	});
});
