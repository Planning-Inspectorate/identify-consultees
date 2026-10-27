import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { acquireDbTestLock, releaseDbTestLock } from './db-test-lock.ts';

// a file of this suite's own, never the shared lock - probing the real one would race the
// suites that legitimately hold it
const testLock = path.join(tmpdir(), `identify-consultees-db-test-lock-test-${process.pid}.lock`);

after(() => {
	rmSync(testLock, { force: true });
});

describe('db test lock', () => {
	test('records its holder while held, and is gone once released', async () => {
		await acquireDbTestLock(testLock);
		assert.equal(readFileSync(testLock, 'utf8'), String(process.pid));
		releaseDbTestLock(testLock);
		assert.equal(existsSync(testLock), false);
	});

	test('can be taken again straight after being released', async () => {
		await acquireDbTestLock(testLock);
		releaseDbTestLock(testLock);
		await acquireDbTestLock(testLock);
		releaseDbTestLock(testLock);
	});

	test('breaks a lock whose holder is long gone', async () => {
		// a pid nothing runs under, written long ago - as a crashed suite would leave it
		writeFileSync(testLock, '999999999');
		utimesSync(testLock, new Date(0), new Date(0));
		await acquireDbTestLock(testLock);
		assert.equal(readFileSync(testLock, 'utf8'), String(process.pid));
		releaseDbTestLock(testLock);
	});

	test('breaks a lock old enough that no live suite can still hold it', async () => {
		writeFileSync(testLock, String(process.pid));
		utimesSync(testLock, new Date(0), new Date(0));
		await acquireDbTestLock(testLock);
		releaseDbTestLock(testLock);
	});
});
