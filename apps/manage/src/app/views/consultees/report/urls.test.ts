import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import {
	addConsulteeUrl,
	addedConsultees,
	addedMatchIds,
	categoryStaticMapUrl,
	consulteeSelection,
	consulteesUrl,
	decodeSelectionEntry,
	encodeSelectionEntry,
	excludedIds,
	fitsInReportUrl,
	MAX_REPORT_URL_LENGTH,
	queryValues,
	removeConsulteeUrl,
	removedConsultees,
	reportCreatedUrl,
	reportUrl,
	rulesetUrl
} from './urls.ts';

// a selection entry as the app's URLs carry it - base64url-encoded JSON (see ENCODED_JSON)
const urlParam = (json: string) => Buffer.from(json).toString('base64url');

describe('report url helpers', () => {
	it('should build report URLs without any selection', () => {
		assert.strictEqual(rulesetUrl('case-1', 'rs-1'), '/consultees/case-1/ruleset?ruleset=rs-1');
		assert.strictEqual(reportUrl('case-1', 'rs-1'), '/consultees/case-1/report?ruleset=rs-1');
		assert.strictEqual(reportCreatedUrl('case-1', 'rs-1'), '/consultees/case-1/report/created?ruleset=rs-1');
		assert.strictEqual(
			consulteesUrl('case-1', 'rs-1', 'Parish, town and community councils'),
			'/consultees/case-1/report/consultees?ruleset=rs-1&category=Parish%2C%20town%20and%20community%20councils'
		);
		assert.strictEqual(
			addConsulteeUrl('case-1', 'rs-1', 'Parish, town and community councils'),
			'/consultees/case-1/report/consultees/add?ruleset=rs-1&category=Parish%2C%20town%20and%20community%20councils'
		);
		assert.strictEqual(
			removeConsulteeUrl('case-1', 'rs-1', 'Parish, town and community councils', { matchId: 'm-1' }),
			'/consultees/case-1/report/consultees/remove?ruleset=rs-1&category=Parish%2C%20town%20and%20community%20councils&match=m-1'
		);
		assert.strictEqual(
			removeConsulteeUrl('case-1', 'rs-1', 'Parish, town and community councils', { addedIndex: 2 }),
			'/consultees/case-1/report/consultees/remove?ruleset=rs-1&category=Parish%2C%20town%20and%20community%20councils&added=2'
		);
		assert.strictEqual(
			categoryStaticMapUrl('case-1', 'rs-1', 'Parish, town and community councils'),
			'/consultees/case-1/results/static-map?ruleset=rs-1&category=Parish%2C%20town%20and%20community%20councils'
		);
	});

	it('should append removals and adds in order, encoded', () => {
		const removalJson = JSON.stringify({
			i: 'a b',
			c: 'Parish, town and community councils',
			n: 'A Consultee',
			r: 'not needed'
		});
		const selection = {
			removed: [
				{ id: 'a b', category: 'Parish, town and community councils', name: 'A Consultee', reason: 'not needed' },
				// a hand-added consultee's removal has no match to exclude - no id
				{ category: 'Parish, town and community councils', name: 'Added Consultee', reason: 'duplicate' },
				// an id-only entry (a bare exclude param read back) round-trips as a bare param
				{ id: 'c', category: '', name: '', reason: '' }
			],
			adds: [{ category: 'Parish, town and community councils', name: 'A&B Consultee', reason: 'it borders' }]
		};
		assert.strictEqual(
			rulesetUrl('case-1', 'rs-1', selection),
			`/consultees/case-1/ruleset?ruleset=rs-1&exclude=${urlParam(removalJson)}&exclude=${urlParam(
				JSON.stringify({ c: 'Parish, town and community councils', n: 'Added Consultee', r: 'duplicate' })
			)}&exclude=c&add=${urlParam('{"c":"Parish, town and community councils","n":"A&B Consultee","r":"it borders"}')}`
		);
		// the static map carries exclusions only, as bare ids - hand-added consultees have no
		// geometry to draw and reasons don't affect the map
		assert.strictEqual(
			categoryStaticMapUrl('case-1', 'rs-1', 'Parish, town and community councils', selection),
			'/consultees/case-1/results/static-map?ruleset=rs-1&category=Parish%2C%20town%20and%20community%20councils&exclude=a%20b&exclude=c'
		);
	});

	it('should build a ruleset picker URL with no ruleset chosen, opening the query string itself', () => {
		assert.strictEqual(rulesetUrl('case-1'), '/consultees/case-1/ruleset');
		assert.strictEqual(
			rulesetUrl('case-1', undefined, {
				removed: [{ id: 'm-1', category: '', name: '', reason: '' }],
				adds: [{ category: 'Parish, town and community councils', name: 'A Consultee', reason: 'borders' }]
			}),
			`/consultees/case-1/ruleset?exclude=m-1&add=${urlParam(
				JSON.stringify({ c: 'Parish, town and community councils', n: 'A Consultee', r: 'borders' })
			)}`
		);
	});

	it('should serialize a name-less removal with no id as an empty exclude param', () => {
		// an id-only entry carries no name - and if it carried no id either there's nothing to encode
		assert.strictEqual(
			rulesetUrl('case-1', 'rs-1', { removed: [{ category: '', name: '', reason: '' }], adds: [] }),
			'/consultees/case-1/ruleset?ruleset=rs-1&exclude='
		);
	});

	it('should read repeated and single query values the same', () => {
		assert.deepStrictEqual(queryValues('a'), ['a']);
		assert.deepStrictEqual(queryValues(['a', 'b']), ['a', 'b']);
		assert.deepStrictEqual(queryValues(undefined), []);
		assert.deepStrictEqual(queryValues(''), []);
		assert.deepStrictEqual(queryValues(['a', '', 1, null]), ['a']);
	});

	it('should parse remove params - JSON removals and bare ids - and skip malformed entries', () => {
		assert.deepStrictEqual(removedConsultees(undefined), []);
		assert.deepStrictEqual(
			removedConsultees([
				'{"i":"m-1","c":"Parish, town and community councils","n":"A Consultee","r":"not needed"}',
				'{"c":"Parish, town and community councils","n":"Added Consultee","r":"duplicate"}',
				'bare-id',
				'{"i":"m-2","c":"Parish, town and community councils","n":"No Reason Given"}',
				'not json {',
				'{}',
				'{"i":"m-3","n":"no category"}',
				'{"c":"Parish, town and community councils","n":""}',
				'[1,2]'
			]),
			[
				{ id: 'm-1', category: 'Parish, town and community councils', name: 'A Consultee', reason: 'not needed' },
				{ category: 'Parish, town and community councils', name: 'Added Consultee', reason: 'duplicate' },
				{ id: 'bare-id', category: '', name: '', reason: '' },
				{ id: 'm-2', category: 'Parish, town and community councils', name: 'No Reason Given', reason: '' },
				{ id: 'not json {', category: '', name: '', reason: '' },
				// a JSON value that isn't an object round-trips as a bare id too
				{ id: '[1,2]', category: '', name: '', reason: '' }
			]
		);
	});

	it('should collect excluded ids from JSON removals and bare params alike', () => {
		assert.deepStrictEqual(excludedIds(['x', 'y']), new Set(['x', 'y']));
		assert.deepStrictEqual(
			excludedIds([
				'{"i":"m-1","c":"Parish, town and community councils","n":"A Consultee","r":"r"}',
				'{"c":"Parish, town and community councils","n":"Added Consultee","r":"r"}',
				'bare-id'
			]),
			new Set(['m-1', 'bare-id'])
		);
	});

	it('should read a request query into a selection', () => {
		const selection = consulteeSelection({
			exclude: '{"i":"m-1","c":"Parish, town and community councils","n":"A Consultee","r":"r"}',
			add: '{"c":"Parish, town and community councils","n":"Added Consultee","r":"it borders"}',
			ignored: 'not part of the selection'
		});
		assert.deepStrictEqual(selection.removed, [
			{ id: 'm-1', category: 'Parish, town and community councils', name: 'A Consultee', reason: 'r' }
		]);
		assert.deepStrictEqual(selection.adds, [
			{ category: 'Parish, town and community councils', name: 'Added Consultee', reason: 'it borders' }
		]);
	});

	it('should read a missing query as an empty selection', () => {
		assert.deepStrictEqual(consulteeSelection(undefined), { removed: [], adds: [] });
	});

	it('should parse add params and skip entries that are not valid consultees', () => {
		assert.deepStrictEqual(addedConsultees(undefined), []);
		assert.deepStrictEqual(
			addedConsultees([
				'{"c":"Parish, town and community councils","n":"A Consultee","r":"borders"}',
				'{"c":"Parish, town and community councils","n":"No Reason Given"}',
				'{"i":"m-1","c":"Parish, town and community councils","n":"Picked Nearby","r":"borders"}',
				'{"i":"","c":"Parish, town and community councils","n":"Empty Id","r":"r"}',
				'not json',
				'{}',
				'{"c":"","n":"empty category"}',
				'{"c":"Parish, town and community councils","n":""}',
				'{"c":"Parish, town and community councils","n":42}',
				'[1,2]'
			]),
			[
				{ category: 'Parish, town and community councils', name: 'A Consultee', reason: 'borders' },
				{ category: 'Parish, town and community councils', name: 'No Reason Given', reason: '' },
				// a typed name matched to one of the nearby consultees
				{ id: 'm-1', category: 'Parish, town and community councils', name: 'Picked Nearby', reason: 'borders' },
				{ category: 'Parish, town and community councils', name: 'Empty Id', reason: 'r' }
			]
		);
	});

	it('should carry a picked nearby consultee by id, and draw it as identified on its category map', () => {
		const selection = {
			removed: [],
			adds: [
				{ id: 'm-1', category: 'Parish, town and community councils', name: 'Picked Nearby', reason: 'borders' },
				{
					id: 'm-2',
					category: 'Hospitals operated by NHS trusts and NHS foundation trusts (England)',
					name: 'Picked Hospital',
					reason: 'r'
				},
				{ category: 'Parish, town and community councils', name: 'Typed In', reason: 'r' }
			]
		};
		assert.strictEqual(
			reportUrl('case-1', 'rs-1', { removed: [], adds: selection.adds.slice(0, 1) }),
			`/consultees/case-1/report?ruleset=rs-1&add=${urlParam('{"i":"m-1","c":"Parish, town and community councils","n":"Picked Nearby","r":"borders"}')}`
		);
		assert.deepStrictEqual(addedMatchIds(selection.adds), new Set(['m-1', 'm-2']));
		// only this category's picked consultees - one typed in by name has no area to draw
		assert.strictEqual(
			categoryStaticMapUrl('case-1', 'rs-1', 'Parish, town and community councils', selection),
			'/consultees/case-1/results/static-map?ruleset=rs-1&category=Parish%2C%20town%20and%20community%20councils&include=m-1'
		);
	});

	it("encodes each selection entry so the firewall in front of the service doesn't read it as an attack", () => {
		const entry = {
			i: 'm-1',
			c: 'Parish, town and community councils',
			n: "O'Brien & Sons",
			r: "Asked to be consulted - 'select' sites only"
		};
		const encoded = encodeSelectionEntry(entry);
		// nothing a query-string rule scores: no quotes, braces, colons, spaces or SQL words
		assert.match(encoded, /^eyJ[A-Za-z0-9_-]+$/);
		assert.deepStrictEqual(JSON.parse(decodeSelectionEntry(encoded)), entry);
		// read back from a request, whichever way the link carried it
		const raw = JSON.stringify({ c: 'Parish, town and community councils', n: 'Plain Link', r: 'from before' });
		assert.strictEqual(decodeSelectionEntry(raw), raw);
		assert.deepStrictEqual(
			addedConsultees([
				encodeSelectionEntry({
					c: 'Hospitals operated by NHS trusts and NHS foundation trusts (England)',
					n: 'Encoded',
					r: 'r'
				}),
				raw
			]),
			[
				{
					category: 'Hospitals operated by NHS trusts and NHS foundation trusts (England)',
					name: 'Encoded',
					reason: 'r'
				},
				{ category: 'Parish, town and community councils', name: 'Plain Link', reason: 'from before' }
			]
		);
		assert.deepStrictEqual(removedConsultees(encoded), [
			{
				id: 'm-1',
				category: 'Parish, town and community councils',
				name: "O'Brien & Sons",
				reason: "Asked to be consulted - 'select' sites only"
			}
		]);
		// a bare id isn't mistaken for an encoded entry
		assert.deepStrictEqual(removedConsultees('e95b2b20-d5b4-8f58-8c5b-3febc472d176'), [
			{ id: 'e95b2b20-d5b4-8f58-8c5b-3febc472d176', category: '', name: '', reason: '' }
		]);
	});
});

describe('a long selection, in one compact param', () => {
	const CASE = '44444444-4444-4444-4444-444444444444';
	const RULESET = 'england-wales-post-20240430';
	const parish = 'Parish, town and community councils';
	const removals = (count: number) =>
		Array.from({ length: count }, (_, index) => ({
			id: randomUUID(),
			category: parish,
			name: `Parish ${index}`,
			reason: index % 2 ? 'Outside the order limits, agreed with the case team' : 'Not affected – merged in 2024'
		}));
	const queryOf = (url: string) => {
		const query: Record<string, string | string[]> = {};
		for (const [key, value] of new URL(url, 'https://example.test').searchParams) {
			const existing = query[key];
			query[key] = existing === undefined ? value : [...[existing].flat(), value];
		}
		return query;
	};

	it('keeps a param an entry while short, and one deflated param once long', () => {
		const short = consulteesUrl(CASE, RULESET, parish, { removed: removals(2), adds: [] });
		assert.match(short, /&exclude=eyJ/);
		assert.doesNotMatch(short, /selection=/);

		const long = consulteesUrl(CASE, RULESET, parish, { removed: removals(40), adds: [] });
		assert.doesNotMatch(long, /exclude=/);
		assert.match(long, /&selection=[A-Za-z0-9_-]+$/);
	});

	it('reads back every removal and add as they were, a bare-id removal too', () => {
		const selection = {
			removed: [
				...removals(40),
				{ id: 'bare-id', category: '', name: '', reason: '' },
				// a hand-added consultee's removal has no id
				{ category: parish, name: 'Typed Parish', reason: 'Added by mistake' }
			],
			adds: [{ id: randomUUID(), category: parish, name: 'Middleton (Lancaster)', reason: 'Asked to be consulted' }]
		};
		const url = consulteesUrl(CASE, RULESET, parish, selection);
		assert.deepStrictEqual(consulteeSelection(queryOf(url)), selection);
	});

	it('fits 100 removals in a report URL, where a param each needed over 20KB', () => {
		const url = consulteesUrl(CASE, RULESET, parish, { removed: removals(100), adds: [] });
		assert.ok(url.length < MAX_REPORT_URL_LENGTH, String(url.length));
		assert.ok(fitsInReportUrl(url));
		assert.ok(!fitsInReportUrl('x'.repeat(MAX_REPORT_URL_LENGTH + 1)));
	});

	it('reads the compact param alongside a param an entry, as a link may mix them', () => {
		const compact = consulteesUrl(CASE, RULESET, parish, { removed: removals(40), adds: [] });
		const query = {
			...queryOf(compact),
			exclude: encodeSelectionEntry({ i: 'older', c: parish, n: 'Older', r: 'r' })
		};
		const selection = consulteeSelection(query);
		assert.strictEqual(selection.removed.length, 41);
		assert.strictEqual(selection.removed.at(-1)?.id, 'older');
	});

	it("ignores a compact param it can't read, and entries that aren't complete", () => {
		const compact = (value: unknown) =>
			deflateRawSync(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
		for (const selection of ['not base64 deflate!', compact('not json'), compact('null')]) {
			assert.deepStrictEqual(consulteeSelection({ selection }), { removed: [], adds: [] });
		}
		assert.deepStrictEqual(
			consulteeSelection({
				selection: compact({
					x: [
						['id', parish, 'Kept', 'r'],
						['id-only'],
						['', parish, '', ''],
						['named-without-category', '', 'Name', 'r'],
						'not a list',
						[1, 2, 3]
					],
					a: [
						['', parish, 'Added', 'r'],
						['bare-add', '', '', '']
					]
				})
			}),
			{
				removed: [
					{ id: 'id', category: parish, name: 'Kept', reason: 'r' },
					{ id: 'id-only', category: '', name: '', reason: '' }
				],
				adds: [{ category: parish, name: 'Added', reason: 'r' }]
			}
		);
		assert.deepStrictEqual(consulteeSelection({ selection: compact({ x: 'no', a: null }) }), {
			removed: [],
			adds: []
		});
	});

	it('refuses one that would inflate past a megabyte', () => {
		const bomb = deflateRawSync(JSON.stringify({ x: [['id', parish, 'n', 'r'.repeat(2_000_000)]] })).toString(
			'base64url'
		);
		assert.deepStrictEqual(consulteeSelection({ selection: bomb }), { removed: [], adds: [] });
	});
});
