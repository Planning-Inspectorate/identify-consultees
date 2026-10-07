import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
	addConsulteeUrl,
	addedConsultees,
	categoryStaticMapUrl,
	consulteesUrl,
	excludedIds,
	queryValues,
	reportCreatedUrl,
	reportUrl
} from './urls.ts';

describe('report url helpers', () => {
	it('should build report URLs without any selection', () => {
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
			categoryStaticMapUrl('case-1', 'rs-1', 'Parish Council'),
			'/consultees/case-1/results/static-map?ruleset=rs-1&category=Parish%20Council'
		);
	});

	it('should append exclusions and adds in order, encoded', () => {
		const selection = {
			excluded: new Set(['a b', 'c']),
			adds: [{ category: 'Parish Council', name: 'A&B Consultee', reason: 'it borders' }]
		};
		assert.strictEqual(
			reportUrl('case-1', 'rs-1', selection),
			'/consultees/case-1/report?ruleset=rs-1&exclude=a%20b&exclude=c&add=%7B%22c%22%3A%22Parish%20Council%22%2C%22n%22%3A%22A%26B%20Consultee%22%2C%22r%22%3A%22it%20borders%22%7D'
		);
		// the static map carries exclusions only - hand-added consultees have no geometry to draw
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
		assert.deepStrictEqual(excludedIds(['x', 'y']), new Set(['x', 'y']));
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
