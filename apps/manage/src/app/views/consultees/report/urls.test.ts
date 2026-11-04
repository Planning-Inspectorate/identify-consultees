import assert from 'node:assert';
import { describe, it } from 'node:test';
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
			consulteesUrl('case-1', 'rs-1', 'Parish Council'),
			'/consultees/case-1/report/consultees?ruleset=rs-1&category=Parish%20Council'
		);
		assert.strictEqual(
			addConsulteeUrl('case-1', 'rs-1', 'Parish Council'),
			'/consultees/case-1/report/consultees/add?ruleset=rs-1&category=Parish%20Council'
		);
		assert.strictEqual(
			removeConsulteeUrl('case-1', 'rs-1', 'Parish Council', { matchId: 'm-1' }),
			'/consultees/case-1/report/consultees/remove?ruleset=rs-1&category=Parish%20Council&match=m-1'
		);
		assert.strictEqual(
			removeConsulteeUrl('case-1', 'rs-1', 'Parish Council', { addedIndex: 2 }),
			'/consultees/case-1/report/consultees/remove?ruleset=rs-1&category=Parish%20Council&added=2'
		);
		assert.strictEqual(
			categoryStaticMapUrl('case-1', 'rs-1', 'Parish Council'),
			'/consultees/case-1/results/static-map?ruleset=rs-1&category=Parish%20Council'
		);
	});

	it('should append removals and adds in order, encoded', () => {
		const removalJson = JSON.stringify({ i: 'a b', c: 'Parish Council', n: 'A Consultee', r: 'not needed' });
		const selection = {
			removed: [
				{ id: 'a b', category: 'Parish Council', name: 'A Consultee', reason: 'not needed' },
				// a hand-added consultee's removal has no match to exclude - no id
				{ category: 'Parish Council', name: 'Added Consultee', reason: 'duplicate' },
				// an id-only entry (a bare exclude param read back) round-trips as a bare param
				{ id: 'c', category: '', name: '', reason: '' }
			],
			adds: [{ category: 'Parish Council', name: 'A&B Consultee', reason: 'it borders' }]
		};
		assert.strictEqual(
			rulesetUrl('case-1', 'rs-1', selection),
			`/consultees/case-1/ruleset?ruleset=rs-1&exclude=${urlParam(removalJson)}&exclude=${urlParam(
				JSON.stringify({ c: 'Parish Council', n: 'Added Consultee', r: 'duplicate' })
			)}&exclude=c&add=${urlParam('{"c":"Parish Council","n":"A&B Consultee","r":"it borders"}')}`
		);
		// the static map carries exclusions only, as bare ids - hand-added consultees have no
		// geometry to draw and reasons don't affect the map
		assert.strictEqual(
			categoryStaticMapUrl('case-1', 'rs-1', 'Parish Council', selection),
			'/consultees/case-1/results/static-map?ruleset=rs-1&category=Parish%20Council&exclude=a%20b&exclude=c'
		);
	});

	it('should build a ruleset picker URL with no ruleset chosen, opening the query string itself', () => {
		assert.strictEqual(rulesetUrl('case-1'), '/consultees/case-1/ruleset');
		assert.strictEqual(
			rulesetUrl('case-1', undefined, {
				removed: [{ id: 'm-1', category: '', name: '', reason: '' }],
				adds: [{ category: 'Parish Council', name: 'A Consultee', reason: 'borders' }]
			}),
			`/consultees/case-1/ruleset?exclude=m-1&add=${urlParam(
				JSON.stringify({ c: 'Parish Council', n: 'A Consultee', r: 'borders' })
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
				'{"i":"m-1","c":"Parish Council","n":"A Consultee","r":"not needed"}',
				'{"c":"Parish Council","n":"Added Consultee","r":"duplicate"}',
				'bare-id',
				'{"i":"m-2","c":"Parish Council","n":"No Reason Given"}',
				'not json {',
				'{}',
				'{"i":"m-3","n":"no category"}',
				'{"c":"Parish Council","n":""}',
				'[1,2]'
			]),
			[
				{ id: 'm-1', category: 'Parish Council', name: 'A Consultee', reason: 'not needed' },
				{ category: 'Parish Council', name: 'Added Consultee', reason: 'duplicate' },
				{ id: 'bare-id', category: '', name: '', reason: '' },
				{ id: 'm-2', category: 'Parish Council', name: 'No Reason Given', reason: '' },
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
				'{"i":"m-1","c":"Parish Council","n":"A Consultee","r":"r"}',
				'{"c":"Parish Council","n":"Added Consultee","r":"r"}',
				'bare-id'
			]),
			new Set(['m-1', 'bare-id'])
		);
	});

	it('should read a request query into a selection', () => {
		const selection = consulteeSelection({
			exclude: '{"i":"m-1","c":"Parish Council","n":"A Consultee","r":"r"}',
			add: '{"c":"Parish Council","n":"Added Consultee","r":"it borders"}',
			ignored: 'not part of the selection'
		});
		assert.deepStrictEqual(selection.removed, [
			{ id: 'm-1', category: 'Parish Council', name: 'A Consultee', reason: 'r' }
		]);
		assert.deepStrictEqual(selection.adds, [
			{ category: 'Parish Council', name: 'Added Consultee', reason: 'it borders' }
		]);
	});

	it('should read a missing query as an empty selection', () => {
		assert.deepStrictEqual(consulteeSelection(undefined), { removed: [], adds: [] });
	});

	it('should parse add params and skip entries that are not valid consultees', () => {
		assert.deepStrictEqual(addedConsultees(undefined), []);
		assert.deepStrictEqual(
			addedConsultees([
				'{"c":"Parish Council","n":"A Consultee","r":"borders"}',
				'{"c":"Parish Council","n":"No Reason Given"}',
				'{"i":"m-1","c":"Parish Council","n":"Picked Nearby","r":"borders"}',
				'{"i":"","c":"Parish Council","n":"Empty Id","r":"r"}',
				'not json',
				'{}',
				'{"c":"","n":"empty category"}',
				'{"c":"Parish Council","n":""}',
				'{"c":"Parish Council","n":42}',
				'[1,2]'
			]),
			[
				{ category: 'Parish Council', name: 'A Consultee', reason: 'borders' },
				{ category: 'Parish Council', name: 'No Reason Given', reason: '' },
				// a typed name matched to one of the nearby consultees
				{ id: 'm-1', category: 'Parish Council', name: 'Picked Nearby', reason: 'borders' },
				{ category: 'Parish Council', name: 'Empty Id', reason: 'r' }
			]
		);
	});

	it('should carry a picked nearby consultee by id, and draw it as identified on its category map', () => {
		const selection = {
			removed: [],
			adds: [
				{ id: 'm-1', category: 'Parish Council', name: 'Picked Nearby', reason: 'borders' },
				{ id: 'm-2', category: 'Hospital', name: 'Picked Hospital', reason: 'r' },
				{ category: 'Parish Council', name: 'Typed In', reason: 'r' }
			]
		};
		assert.strictEqual(
			reportUrl('case-1', 'rs-1', { removed: [], adds: selection.adds.slice(0, 1) }),
			`/consultees/case-1/report?ruleset=rs-1&add=${urlParam('{"i":"m-1","c":"Parish Council","n":"Picked Nearby","r":"borders"}')}`
		);
		assert.deepStrictEqual(addedMatchIds(selection.adds), new Set(['m-1', 'm-2']));
		// only this category's picked consultees - one typed in by name has no area to draw
		assert.strictEqual(
			categoryStaticMapUrl('case-1', 'rs-1', 'Parish Council', selection),
			'/consultees/case-1/results/static-map?ruleset=rs-1&category=Parish%20Council&include=m-1'
		);
	});

	it("encodes each selection entry so the firewall in front of the service doesn't read it as an attack", () => {
		const entry = {
			i: 'm-1',
			c: 'Parish Council',
			n: "O'Brien & Sons",
			r: "Asked to be consulted - 'select' sites only"
		};
		const encoded = encodeSelectionEntry(entry);
		// nothing a query-string rule scores: no quotes, braces, colons, spaces or SQL words
		assert.match(encoded, /^eyJ[A-Za-z0-9_-]+$/);
		assert.deepStrictEqual(JSON.parse(decodeSelectionEntry(encoded)), entry);
		// read back from a request, whichever way the link carried it
		const raw = JSON.stringify({ c: 'Parish Council', n: 'Plain Link', r: 'from before' });
		assert.strictEqual(decodeSelectionEntry(raw), raw);
		assert.deepStrictEqual(addedConsultees([encodeSelectionEntry({ c: 'Hospital', n: 'Encoded', r: 'r' }), raw]), [
			{ category: 'Hospital', name: 'Encoded', reason: 'r' },
			{ category: 'Parish Council', name: 'Plain Link', reason: 'from before' }
		]);
		assert.deepStrictEqual(removedConsultees(encoded), [
			{
				id: 'm-1',
				category: 'Parish Council',
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
