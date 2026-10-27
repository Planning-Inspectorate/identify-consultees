import { closeSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// node --test runs each test file in its own process, so the suites that mutate the real,
// shared consultee_area / case_boundary tables - or read them in ways another suite's rows
// could break - can overlap: an import suite replacing the whole table mid-run can delete
// rows a geospatial suite just wrote and is about to read back, and a second suite's fixture
// can join a run halfway through another's. A lock file in the OS temp dir gives those files
// a cross-process mutex - acquire it in before() and release in after().
const LOCK_FILE = path.join(tmpdir(), 'identify-consultees-db-tests.lock');
const RETRY_MS = 50;
// a holder writes its pid a moment after creating the file - a lock younger than this may
// just be mid-creation, not abandoned
const WRITE_GRACE_MS = 5_000;
// no suite holds the lock this long - past it the holder was killed without releasing,
// whatever pid the file claims
const ABANDONED_MS = 10 * 60 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether the process recorded in the lock is still running. A crashed or interrupted test
 * run leaves the file behind, and without this every later run would wait forever.
 */
function holderIsAlive(lockFile: string): boolean {
	const pid = Number(readFileSync(lockFile, 'utf8').trim());
	if (!pid) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Whether a held lock was abandoned rather than is merely contended: its holder is dead or
 * its file predates the pid write - but only once the file is old enough to rule out a
 * process still creating it (the file exists a moment before its owner is written into it).
 */
function lockIsStale(lockFile: string): boolean {
	const ageMs = Date.now() - statSync(lockFile).mtimeMs;
	return ageMs > ABANDONED_MS || (!holderIsAlive(lockFile) && ageMs > WRITE_GRACE_MS);
}

/**
 * Take the shared-tables test mutex, waiting until the current holder releases it.
 * `lockFile` exists for this file's own tests - every suite shares the default.
 */
export async function acquireDbTestLock(lockFile: string = LOCK_FILE): Promise<void> {
	for (;;) {
		try {
			// O_EXCL: the create itself is the acquisition, so no other process can be
			// between creating and owning it
			const fd = openSync(lockFile, 'wx');
			try {
				writeFileSync(fd, String(process.pid));
			} finally {
				closeSync(fd);
			}
			return;
		} catch {
			try {
				if (lockIsStale(lockFile)) {
					rmSync(lockFile, { recursive: true, force: true });
				}
			} catch {
				// it vanished mid-check - the retry either creates it or waits on the new holder
			}
			await sleep(RETRY_MS);
		}
	}
}

/**
 * Release the shared-tables test mutex.
 */
export function releaseDbTestLock(lockFile: string = LOCK_FILE): void {
	// recursive too: the lock used to be a directory - force is not enough to clear one left behind
	rmSync(lockFile, { recursive: true, force: true });
}
