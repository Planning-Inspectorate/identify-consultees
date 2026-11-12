import assert from 'node:assert';
import { describe, it } from 'node:test';
import { BoundedCache } from './bounded-cache.ts';

describe('BoundedCache', () => {
	it('keeps at most maxEntries, dropping the least recently used', () => {
		const cache = new BoundedCache<number>({ maxEntries: 2, ttlMs: 1_000 });
		cache.set('a', 1);
		cache.set('b', 2);
		// reading a makes b the least recently used
		assert.strictEqual(cache.get('a'), 1);
		cache.set('c', 3);
		assert.strictEqual(cache.size, 2);
		assert.strictEqual(cache.get('b'), undefined);
		assert.strictEqual(cache.get('a'), 1);
		assert.strictEqual(cache.get('c'), 3);
		// setting a key again replaces it, without growing
		cache.set('c', 4);
		assert.strictEqual(cache.size, 2);
		assert.strictEqual(cache.get('c'), 4);
	});

	it('forgets an entry once it is older than ttlMs', () => {
		let now = 0;
		const cache = new BoundedCache<string>({ maxEntries: 10, ttlMs: 100, now: () => now });
		cache.set('tile', 'png');
		now = 100;
		assert.strictEqual(cache.get('tile'), 'png');
		now = 201;
		assert.strictEqual(cache.get('tile'), undefined);
		assert.strictEqual(cache.size, 0);
	});

	it('deletes and clears', () => {
		const cache = new BoundedCache<number>({ maxEntries: 10, ttlMs: 1_000 });
		cache.set('a', 1);
		cache.set('b', 2);
		cache.delete('a');
		assert.strictEqual(cache.get('a'), undefined);
		cache.clear();
		assert.strictEqual(cache.size, 0);
	});
});
