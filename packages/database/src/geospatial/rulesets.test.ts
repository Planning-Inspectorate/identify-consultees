import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
	buildRulesetFromCsv,
	CATEGORIES_AWAITING_DATA,
	DEFAULT_RULESET_ID,
	getRuleset,
	isIdentifiedByCondition,
	loadRulesets,
	parseCsv,
	parseRulesetCsv,
	rulesetIdFromFileName,
	rulesetNameFromFileName,
	RULESETS
} from './rulesets.ts';

// running a ruleset is the Python function's job now - see apps/function-python/intersector/test_screening.py

const HEADER = 'Group hierarchy,Group,Category,Consultee Type(s),Logic,Buffer (km)';

describe('parseCsv', () => {
	test('splits rows and fields as Excel saves them, including quoted commas and quotes', () => {
		assert.deepEqual(parseCsv('\uFEFFa,b,c\r\n1,"two, three","say ""hi"""\r\n\r\n4,,6'), [
			['a', 'b', 'c'],
			['1', 'two, three', 'say "hi"'],
			['4', '', '6']
		]);
	});

	test('keeps a line break inside a quoted field, and a last row with no line ending', () => {
		assert.deepEqual(parseCsv('a,b\n"line one\nline two",x'), [
			['a', 'b'],
			['line one\nline two', 'x']
		]);
	});

	test('treats a lone carriage return as a row break and a trailing comma as an empty last field', () => {
		assert.deepEqual(parseCsv('a,\rb,c'), [
			['a', ''],
			['b', 'c']
		]);
		assert.deepEqual(parseCsv('a,b,'), [['a', 'b', '']]);
	});
});

describe('parseRulesetCsv', () => {
	test('maps a host authority row to its category, named with its authority letter', () => {
		const [rule] = parseRulesetCsv(
			`${HEADER}\n1,Administative boundaries,B Host Authority,Unitary Authorities,Intersects application site,0`
		);
		assert.deepEqual(rule, {
			id: 'b_host_unitary_authorities',
			name: '"B" host Unitary Authorities',
			logicType: 'intersection',
			categories: ['Unitary Authority'],
			bufferMetres: 0
		});
	});

	test('maps a bordering row to its categories and host, quoting the host letter in its name', () => {
		const [rule] = parseRulesetCsv(
			`${HEADER}\n1,Administative boundaries,D Bordering Authority,"County Councils, Unitary Authorities, National Parks & Broads bordering C Host County Councils",Borders host authority,0`
		);
		assert.deepEqual(rule, {
			id: 'd_bordering_county_councils_unitary_authorities_national_parks_broads_bordering_c_host_county_councils',
			name: '"D" County Councils, Unitary Authorities, National Parks & Broads bordering "C" host County Councils',
			logicType: 'bordering',
			categories: ['Upper Tier Authority', 'Unitary Authority', 'National Park'],
			hostCategory: 'Upper Tier Authority'
		});
	});

	test('takes a buffer in km, keeps a row the same buffer and type apart, and reads a blank buffer as 0', () => {
		const rules = parseRulesetCsv(
			[
				HEADER,
				'2,Public bodies,,Ambulance Trusts,Intersects application site buffer,1',
				'2,Public bodies,,Ambulance Trusts,Intersects application site buffer,10',
				'5,Other,,cheshire  BRINE area,intersects application site,',
				// and a row simply short of the column, which reads the missing cell as blank too
				'4,Transport,,Railways,Intersects application site'
			].join('\n')
		);
		assert.deepEqual(
			rules.map((rule) => [rule.id, rule.name, rule.bufferMetres, rule.categories]),
			[
				['ambulance_trusts_1km', 'Ambulance Trusts', 1000, ['Ambulance Trust']],
				['ambulance_trusts_10km', 'Ambulance Trusts', 10000, ['Ambulance Trust']],
				// matched case- and space-insensitively, named as written
				['cheshire_brine_area', 'cheshire  BRINE area', 0, ['Cheshire Brine Area']],
				['railways', 'Railways', 0, ['Railway']]
			]
		);
	});

	const invalid: [string, string, RegExp][] = [
		[
			'an unknown consultee type',
			'2,Public bodies,,Space Agencies,Intersects application site,0',
			/Unknown consultee type in ruleset row 2/
		],
		['an unknown logic', '2,Public bodies,,Ambulance Trusts,Near the site,0', /Unknown logic "Near the site"/],
		[
			'a buffer that is not a number',
			'2,Public bodies,,Ambulance Trusts,Intersects application site buffer,ten',
			/must be a number/
		],
		[
			'a negative buffer',
			'2,Public bodies,,Ambulance Trusts,Intersects application site buffer,-1',
			/must be a number/
		],
		[
			'a buffer without the buffer logic',
			'2,Public bodies,,Ambulance Trusts,Intersects application site,5',
			/can have a buffer/
		],
		[
			'a bordering row with no host',
			'2,Public bodies,,Ambulance Trusts,Borders host authority,0',
			/needs a host authority/
		],
		[
			'two rows that would share an id',
			'2,Public bodies,,Ambulance Trusts,Intersects application site buffer,1\n2,Public bodies,,Ambulance Trusts,Intersects application site buffer,1',
			/both be condition "ambulance_trusts_1km"/
		]
	];
	for (const [name, rows, error] of invalid) {
		test(`throws, naming the row, on ${name}`, () => {
			assert.throws(() => parseRulesetCsv(`${HEADER}\n${rows}`), error);
		});
	}

	test('throws on a CSV missing an expected column, or with no header at all', () => {
		assert.throws(() => parseRulesetCsv('Group,Category\n1,2'), /missing expected column "Group hierarchy"/);
		assert.throws(() => parseRulesetCsv(''), /missing expected column/);
	});
});

describe('buildRulesetFromCsv', () => {
	test('wraps every row of a ruleset CSV as one ruleset', () => {
		const ruleset = buildRulesetFromCsv(
			'test-ruleset',
			'Test ruleset',
			`${HEADER}\n4,Transport,,Railways,Intersects application site buffer,10\n2,Public bodies,,Hospitals operated by NHS Trusts and NHS Foundation Trusts (England),Intersects application site buffer,10`
		);
		assert.equal(ruleset.id, 'test-ruleset');
		assert.equal(ruleset.name, 'Test ruleset');
		assert.deepEqual(
			ruleset.rules.map((rule) => rule.categories),
			[['Railway'], ['Hospital']]
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
		// so is a date-shaped word whose day is out of range (April has no 32nd)
		assert.equal(rulesetNameFromFileName('wales_20240432_ruleset.csv'), 'Wales 20240432');
	});
});

describe('loadRulesets', () => {
	const header = HEADER;
	const row = '4,Transport,,Railways,Intersects application site buffer,10';

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

	test('puts the default ruleset first, wherever its file sorts', () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'rulesets-'));
		try {
			for (const file of ['a_ruleset.csv', 'b_ruleset.csv', 'c_ruleset.csv']) {
				writeFileSync(path.join(dir, file), `${header}\n${row}\n`);
			}
			assert.deepEqual(
				loadRulesets(dir, 'b').map((ruleset) => ruleset.id),
				['b', 'a', 'c']
			);
			// an unknown default leaves file-name order
			assert.deepEqual(
				loadRulesets(dir, 'missing').map((ruleset) => ruleset.id),
				['a', 'b', 'c']
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

describe('isIdentifiedByCondition', () => {
	test('is true when any condition matched, false when only the nearby search found it', () => {
		assert.equal(
			isIdentifiedByCondition({
				reasons: [
					{ type: 'nearby', radiusMetres: 20000 },
					{ type: 'condition', conditionId: 'railways_10km' }
				]
			}),
			true
		);
		assert.equal(isIdentifiedByCondition({ reasons: [{ type: 'nearby', radiusMetres: 20000 }] }), false);
	});
});

describe('rulesets registry', () => {
	test('loads the three rulesets from the workbook, England and Wales post 30 April 2024 first', () => {
		assert.deepEqual(
			RULESETS.map((ruleset) => [ruleset.id, ruleset.name, ruleset.rules.length]),
			[
				['england-wales-post-20240430', 'England Wales post 30 April 2024', 34],
				['england-pre-20240430', 'England pre 30 April 2024', 31],
				['wales-pre-20240430', 'Wales pre 30 April 2024', 23]
			]
		);
		assert.equal(RULESETS[0].id, DEFAULT_RULESET_ID);
	});

	test('every condition matches a category the reference data has, or one deliberately awaiting data', () => {
		// the consultee_area categories in the reference data today (see kt-docs/data/reference-data.md)
		const referenceCategories = new Set([
			'Ambulance Trust',
			'DNO',
			'Dock or Harbour',
			'Electricity Generator',
			'Fire and Rescue Authority',
			'Greater London Authority',
			'Hospital',
			'ICB',
			'Integrated Transport Authority',
			'Interconnector',
			'Internal Drainage Board',
			'Internal Drainage District',
			'Local Health Board',
			'Local Resilience Forum',
			'Lower Tier Authority',
			'National Landscape',
			'National Park',
			'ONR Site',
			'Offshore Wind Export Cable',
			'Offshore Wind Site',
			'Parish Council',
			'Passenger Transport Executive',
			'Police',
			'Railway',
			'Unitary Authority',
			'Upper Tier Authority'
		]);
		const categories = RULESETS.flatMap((ruleset) =>
			ruleset.rules.flatMap((rule) => [...rule.categories, ...(rule.hostCategory ? [rule.hostCategory] : [])])
		);
		const unknown = categories.filter(
			(category) => !referenceCategories.has(category) && !CATEGORIES_AWAITING_DATA.has(category)
		);
		assert.deepEqual([...new Set(unknown)], []);
		// and everything awaiting data is still used, so the list doesn't go stale
		assert.deepEqual(
			[...CATEGORIES_AWAITING_DATA].filter((category) => !categories.includes(category)),
			[]
		);
	});

	test("every condition id fits the screening function's 200-character limit", () => {
		const longest = Math.max(...RULESETS.flatMap((ruleset) => ruleset.rules.map((rule) => rule.id.length)));
		assert.ok(longest <= 200, `longest condition id is ${longest} characters`);
	});

	test('getRuleset finds a known ruleset by id and returns undefined for an unknown one', () => {
		assert.ok(getRuleset('wales-pre-20240430'));
		assert.equal(getRuleset('not-a-real-ruleset'), undefined);
	});
});
