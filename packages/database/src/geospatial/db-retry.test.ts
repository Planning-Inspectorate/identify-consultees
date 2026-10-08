import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isDeadlockError, withDeadlockRetry } from './db-retry.ts';

describe('isDeadlockError', () => {
	test('recognises a SQL Server deadlock message', () => {
		assert.ok(isDeadlockError(new Error('Transaction was deadlocked on lock resources...')));
		assert.ok(isDeadlockError(new Error('DEADLOCK detected')));
	});

	test('does not misclassify other errors', () => {
		assert.ok(!isDeadlockError(new Error('Timeout: Request failed to complete in 15000ms')));
		assert.ok(!isDeadlockError('not an Error instance'));
		assert.ok(!isDeadlockError(undefined));
	});
});

describe('withDeadlockRetry', () => {
	test('returns the result on the first success without retrying', async () => {
		const fn = async () => 'ok';
		assert.equal(await withDeadlockRetry(fn), 'ok');
	});

	test('retries on a deadlock and returns the eventual success', async () => {
		let attempts = 0;
		const fn = async () => {
			attempts += 1;
			if (attempts < 3) {
				throw new Error('deadlocked on lock resources');
			}
			return 'ok';
		};
		assert.equal(await withDeadlockRetry(fn), 'ok');
		assert.equal(attempts, 3);
	});

	test('gives up after the retry limit and rethrows the deadlock error', async () => {
		const fn = async () => {
			throw new Error('deadlocked on lock resources');
		};
		await assert.rejects(() => withDeadlockRetry(fn, 2), /deadlocked/);
	});

	test('does not retry a request timeout - re-running a slow query just repeats the wait', async () => {
		let attempts = 0;
		const fn = async () => {
			attempts += 1;
			throw new Error('Timeout: Request failed to complete in 15000ms');
		};
		await assert.rejects(() => withDeadlockRetry(fn), /Request failed to complete/);
		assert.equal(attempts, 1);
	});

	test('rethrows a non-deadlock error immediately, without retrying', async () => {
		let attempts = 0;
		const fn = async () => {
			attempts += 1;
			throw new Error('some other error');
		};
		await assert.rejects(() => withDeadlockRetry(fn), /some other error/);
		assert.equal(attempts, 1);
	});
});
