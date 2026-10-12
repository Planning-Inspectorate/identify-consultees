import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
	addConsulteeUrl,
	addedConsultees,
	categoryStaticMapUrl,
	consulteeSelection,
	consulteesUrl,
	excludedIds,
	queryValues,
	removeConsulteeUrl,
	removedConsultees,
	reportCreatedUrl,
	reportUrl,
	rulesetUrl
} from './urls.ts';

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
			`/consultees/case-1/ruleset?ruleset=rs-1&exclude=${encodeURIComponent(removalJson)}&exclude=${encodeURIComponent(
				JSON.stringify({ c: 'Parish Council', n: 'Added Consultee', r: 'duplicate' })
			)}&exclude=c&add=%7B%22c%22%3A%22Parish%20Council%22%2C%22n%22%3A%22A%26B%20Consultee%22%2C%22r%22%3A%22it%20borders%22%7D`
		);
		// the static map carries exclusions only, as bare ids - hand-added consultees have no
		// geometry to draw and reasons don't affect the map
		assert.strictEqual(
			categoryStaticMapUrl('case-1', 'rs-1', 'Parish Council', selection),
			'/consultees/case-1/results/static-map?ruleset=rs-1&category=Parish%20Council&exclude=a%20b&exclude=c'
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
				'not json',
				'{}',
				'{"c":"","n":"empty category"}',
				'{"c":"Parish Council","n":""}',
				'{"c":"Parish Council","n":42}',
				'[1,2]'
			]),
			[
				{ category: 'Parish Council', name: 'A Consultee', reason: 'borders' },
				{ category: 'Parish Council', name: 'No Reason Given', reason: '' }
			]
		);
	});
});
