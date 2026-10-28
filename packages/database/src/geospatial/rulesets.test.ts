import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
	acceptedConsulteeTypes,
	buildRulesetFromCsv,
	getRuleset,
	isIdentified,
	loadRulesets,
	parseCsv,
	parseRulesetCsv,
	parseRulesetSettings,
	RULESET_SETTINGS,
	rulesetIdFromFileName,
	rulesetNameFromFileName,
	RULESETS,
	type RulesetSettings
} from './rulesets.ts';

// running a ruleset is the Python function's job now - see apps/function-python/intersector/test_screening.py

const HEADER = 'Group hierarchy,Group,Category,Consultee Type(s),Logic,Buffer (km)';

const SETTINGS = `
version: 1
default: b
names:
  c: Ruleset C
consulteeTypes:
  Railways:
    categories: [Railway]
  Parish Councils bordering Host Parish Councils:
    categories: [Parish Council]
    hostCategory: Parish Council
logic:
  Intersects application site: intersection
  Intersects application site buffer: buffer
  Borders host authority: bordering
categoriesAwaitingData: [Canal]
`;

describe('parseRulesetSettings', () => {
	test('reads the default, the names, and what each wording means, keyed case- and space-insensitively', () => {
		const settings = parseRulesetSettings(SETTINGS);
		assert.equal(settings.default, 'b');
		assert.deepEqual(settings.names, { c: 'Ruleset C' });
		assert.deepEqual(
			[...settings.consulteeTypes],
			[
				['railways', { categories: ['Railway'] }],
				[
					'parish councils bordering host parish councils',
					{ categories: ['Parish Council'], hostCategory: 'Parish Council' }
				]
			]
		);
		assert.equal(settings.logic.get('intersects application site buffer'), 'buffer');
		assert.deepEqual([...settings.categoriesAwaitingData], ['Canal']);
	});

	test('lists the accepted consultee type wordings as written, and which await data', () => {
		const settings = parseRulesetSettings(
			SETTINGS.replace('consulteeTypes:\n', 'consulteeTypes:\n  Canals  England:\n    categories: [Canal]\n')
		);
		assert.deepEqual(acceptedConsulteeTypes(settings), [
			{ wording: 'Canals  England', awaitingData: true },
			{ wording: 'Railways', awaitingData: false },
			{ wording: 'Parish Councils bordering Host Parish Councils', awaitingData: false }
		]);
		// the real settings: every wording, the ones with no data yet among them
		const real = acceptedConsulteeTypes();
		assert.ok(real.length > 30);
		assert.ok(real.some(({ wording, awaitingData }) => wording === 'Cheshire Brine Area' && awaitingData));
		assert.ok(real.some(({ wording, awaitingData }) => wording === 'Ambulance Trusts' && !awaitingData));
	});

	test('treats names and categoriesAwaitingData as optional', () => {
		const settings = parseRulesetSettings(
			SETTINGS.replace(/names:\n {2}c: Ruleset C\n/, '').replace('categoriesAwaitingData: [Canal]', '')
		);
		assert.deepEqual(settings.names, {});
		assert.deepEqual([...settings.categoriesAwaitingData], []);
	});

	test('reads config/rulesets/rulesets.yaml', () => {
		assert.ok(RULESET_SETTINGS.consulteeTypes.size > 0);
	});

	for (const [title, text, message] of [
		['an empty file', '', /must be a version 1 document/],
		['another version', 'version: 2', /must be a version 1 document/],
		['an unknown top-level key', `${SETTINGS}\nname: {}`, /the document has "name"/],
		['no default', SETTINGS.replace('default: b', ''), /default must be the file name/],
		['names as a list', SETTINGS.replace(/names:\n {2}c: Ruleset C/, 'names: [c]'), /names must map file names/],
		['a blank name', SETTINGS.replace('Ruleset C', '" "'), /names.c must be a display name/],
		[
			'no consultee types',
			SETTINGS.replace(/consulteeTypes:[^]*?logic:/, 'consulteeTypes: {}\nlogic:'),
			/consulteeTypes must map/
		],
		[
			'a repeated wording',
			SETTINGS.replace('  Railways:', '  RAILWAYS:\n    categories: [Railway]\n  Railways:'),
			/consulteeTypes lists "Railways" twice/
		],
		[
			'a consultee type without settings',
			SETTINGS.replace('  Railways:\n    categories: [Railway]', '  Railways: Railway'),
			/consulteeTypes.Railways must set categories/
		],
		['a typo in a consultee type', SETTINGS.replace('    hostCategory:', '    host:'), /has "host"/],
		['no categories', SETTINGS.replace('categories: [Railway]', 'categories: []'), /Railways.categories must list/],
		[
			'a blank host category',
			SETTINGS.replace('hostCategory: Parish Council', 'hostCategory: ""'),
			/hostCategory must be a consultee category/
		],
		['an unknown logic', SETTINGS.replace(': buffer', ': nearby'), /must be intersection, buffer or bordering/],
		['awaiting categories as text', SETTINGS.replace('[Canal]', 'Canal'), /categoriesAwaitingData must list/]
	] as const) {
		test(`refuses ${title}, naming the setting`, () => {
			assert.throws(() => parseRulesetSettings(text), message);
		});
	}
});

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
			// the workbook's Group, as written - the report's export tabs follow it
			group: 'Administative boundaries',
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
			group: 'Administative boundaries',
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
			/Unknown consultee type in ruleset row 2 .* add it to consulteeTypes in config\/rulesets\/rulesets.yaml/
		],
		[
			'an unknown logic',
			'2,Public bodies,,Ambulance Trusts,Near the site,0',
			/Unknown logic "Near the site" .* add it to logic/
		],
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
			/Only a buffer logic can have a buffer/
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
	const row = '4,Transport,,Railways,Intersects application site buffer,10';

	function withRulesets(files: string[], run: (dir: string) => void) {
		const dir = mkdtempSync(path.join(tmpdir(), 'rulesets-'));
		try {
			for (const file of files) {
				writeFileSync(path.join(dir, file), `${HEADER}\n${row}\n`);
			}
			run(dir);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	const settings = (overrides: Partial<RulesetSettings>): RulesetSettings => ({
		...parseRulesetSettings(SETTINGS),
		names: {},
		...overrides
	});

	test('loads every *_ruleset.csv in file-name order, named from the file, and ignores other files', () => {
		withRulesets(['wales_ruleset.csv', 'england_post_20240430_ruleset.csv', 'notes.csv'], (dir) => {
			assert.deepEqual(
				loadRulesets(dir, settings({ default: 'england_post_20240430' })).map((ruleset) => [
					ruleset.id,
					ruleset.name,
					ruleset.rules.length
				]),
				[
					['england-post-20240430', 'England post 30 April 2024', 1],
					['wales', 'Wales', 1]
				]
			);
		});
	});

	test('puts the default ruleset first, wherever its file sorts, and names any the settings name', () => {
		withRulesets(['a_ruleset.csv', 'b_ruleset.csv', 'c_ruleset.csv'], (dir) => {
			assert.deepEqual(
				loadRulesets(dir, parseRulesetSettings(SETTINGS)).map((ruleset) => [ruleset.id, ruleset.name]),
				[
					['b', 'B'],
					['a', 'A'],
					['c', 'Ruleset C']
				]
			);
		});
	});

	test("refuses a default or a name for a file that isn't there, naming it", () => {
		withRulesets(['a_ruleset.csv', 'b_ruleset.csv'], (dir) => {
			assert.throws(
				() => loadRulesets(dir, settings({ default: 'missing' })),
				/rulesets.yaml: default names "missing", but there's no missing_ruleset.csv - use one of a, b/
			);
			assert.throws(
				() => loadRulesets(dir, settings({ default: 'a', names: { c: 'Ruleset C' } })),
				/names.c names "c", but there's no c_ruleset.csv/
			);
		});
	});

	test('refuses two rulesets with the same name', () => {
		withRulesets(['a_ruleset.csv', 'b_ruleset.csv'], (dir) => {
			assert.throws(
				() => loadRulesets(dir, settings({ default: 'a', names: { b: 'A' } })),
				/two rulesets would both be named "A"/
			);
		});
	});

	test('fails loudly rather than starting with no rulesets', () => {
		withRulesets([], (dir) => {
			assert.throws(() => loadRulesets(dir), /No ruleset exports/);
		});
	});
});

describe('isIdentified', () => {
	test('is true when any condition matched, false when only the nearby search found it', () => {
		assert.equal(
			isIdentified({
				reasons: [
					{ type: 'nearby', radiusMetres: 20000 },
					{ type: 'condition', conditionId: 'railways_10km' }
				]
			}),
			true
		);
		assert.equal(isIdentified({ reasons: [{ type: 'nearby', radiusMetres: 20000 }] }), false);
	});

	test('is true for a Nearby NSIP - another case near the site is report content', () => {
		assert.equal(isIdentified({ reasons: [{ type: 'nearbyNsip', radiusMetres: 10000 }] }), true);
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
		assert.equal(RULESETS[0].id, rulesetIdFromFileName(`${RULESET_SETTINGS.default}_ruleset.csv`));
	});

	test('every condition matches a category the reference data has, or one deliberately awaiting data', () => {
		// the consultee_area categories in the reference data today (see kt-docs/data/reference-data.md)
		const referenceCategories = new Set([
			'Ambulance Trust',
			'Canal',
			'Corporate Joint Committee',
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
			(category) => !referenceCategories.has(category) && !RULESET_SETTINGS.categoriesAwaitingData.has(category)
		);
		assert.deepEqual([...new Set(unknown)], []);
		// and everything awaiting data is still used, so the list doesn't go stale
		assert.deepEqual(
			[...RULESET_SETTINGS.categoriesAwaitingData].filter((category) => !categories.includes(category)),
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
