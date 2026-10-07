import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPagination } from './pagination.ts';

const hrefForPage = (page: number) => `/?page=${page}`;

function pageNumbers(pagination: { items: { number?: number; ellipsis?: boolean; current?: boolean }[] }) {
	return pagination.items.map((item) => (item.ellipsis ? '…' : item.number));
}

describe('buildPagination', () => {
	it('returns null for a single page of results', () => {
		assert.strictEqual(buildPagination(1, 1, hrefForPage), null);
	});

	it('returns null when there are no results', () => {
		assert.strictEqual(buildPagination(1, 0, hrefForPage), null);
	});

	it('lists every page when there are seven or fewer', () => {
		const pagination = buildPagination(3, 7, hrefForPage);
		assert.deepEqual(pageNumbers(pagination!), [1, 2, 3, 4, 5, 6, 7]);
	});

	it('marks the current page', () => {
		const pagination = buildPagination(2, 3, hrefForPage);
		const current = pagination!.items.filter((item) => item.current);
		assert.strictEqual(current.length, 1);
		assert.strictEqual(current[0].number, 2);
	});

	it('has a next link but no previous link on the first page', () => {
		const pagination = buildPagination(1, 3, hrefForPage);
		assert.strictEqual(pagination!.previous, undefined);
		assert.deepEqual(pagination!.next, { href: '/?page=2' });
	});

	it('has a previous link but no next link on the last page', () => {
		const pagination = buildPagination(3, 3, hrefForPage);
		assert.deepEqual(pagination!.previous, { href: '/?page=2' });
		assert.strictEqual(pagination!.next, undefined);
	});

	it('has both links on a middle page', () => {
		const pagination = buildPagination(2, 3, hrefForPage);
		assert.deepEqual(pagination!.previous, { href: '/?page=1' });
		assert.deepEqual(pagination!.next, { href: '/?page=3' });
	});

	it('ellipses the tail when the current page is near the start', () => {
		const pagination = buildPagination(2, 20, hrefForPage);
		assert.deepEqual(pageNumbers(pagination!), [1, 2, 3, 4, 5, '…', 20]);
	});

	it('ellipses the head when the current page is near the end', () => {
		const pagination = buildPagination(18, 20, hrefForPage);
		assert.deepEqual(pageNumbers(pagination!), [1, '…', 16, 17, 18, 19, 20]);
	});

	it('ellipses both sides around a middle page', () => {
		const pagination = buildPagination(10, 20, hrefForPage);
		assert.deepEqual(pageNumbers(pagination!), [1, '…', 9, 10, 11, '…', 20]);
	});

	it('links every numbered item to its page', () => {
		const pagination = buildPagination(1, 3, hrefForPage);
		for (const item of pagination!.items) {
			assert.strictEqual(item.href, `/?page=${item.number}`);
		}
	});
});
