import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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

	test('breaks a lock whose dead holder finished writing only seconds ago', async () => {
		// recent enough that a suite could still be creating its lock, so staleness has to be
		// decided by the holder being dead rather than the file's age alone
		writeFileSync(testLock, '999999999');
		const finishedWriting = new Date(Date.now() - 10_000);
		utimesSync(testLock, finishedWriting, finishedWriting);
		await acquireDbTestLock(testLock);
		assert.equal(readFileSync(testLock, 'utf8'), String(process.pid));
		releaseDbTestLock(testLock);
	});

	test('treats a lock with no readable pid as abandoned once the write grace passes', async () => {
		writeFileSync(testLock, 'not-a-pid');
		const finishedWriting = new Date(Date.now() - 10_000);
		utimesSync(testLock, finishedWriting, finishedWriting);
		await acquireDbTestLock(testLock);
		assert.equal(readFileSync(testLock, 'utf8'), String(process.pid));
		releaseDbTestLock(testLock);
	});

	test('retries when the lock cannot even be read mid-check', async () => {
		// a directory where the file should be: the exclusive create fails, then reading it for
		// the staleness check throws inside the check itself - the acquisition must shrug and retry
		mkdirSync(testLock);
		setTimeout(() => rmSync(testLock, { recursive: true, force: true }), 150);
		await acquireDbTestLock(testLock);
		releaseDbTestLock(testLock);
	});

	test('waits on a live holder instead of stealing its lock', async () => {
		// a fresh lock naming a live pid: still within its write grace, so it is contended,
		// not stale - acquisition has to wait for it to go away, not remove it
		writeFileSync(testLock, String(process.pid));
		setTimeout(() => rmSync(testLock, { force: true }), 150);
		await acquireDbTestLock(testLock);
		releaseDbTestLock(testLock);
	});

	test('breaks a lock old enough that no live suite can still hold it', async () => {
		writeFileSync(testLock, String(process.pid));
		utimesSync(testLock, new Date(0), new Date(0));
		await acquireDbTestLock(testLock);
		releaseDbTestLock(testLock);
	});
});
