import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// node --test runs each test file in its own process, so the suites that mutate the real,
// shared consultee_area / case_boundary tables can overlap: an import suite replacing the
// whole table mid-run can delete rows a geospatial suite just wrote and is about to read
// back. A lock directory in the OS temp dir gives those files a cross-process mutex -
// acquire it in before() and release in after().
const LOCK_DIR = path.join(tmpdir(), 'identify-consultees-db-tests.lock');
const OWNER_FILE = path.join(LOCK_DIR, 'owner');
const RETRY_MS = 50;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether the process recorded in the lock is still running. A crashed or interrupted test
 * run leaves the directory behind, and without this every later run would wait forever.
 */
function lockOwnerAlive(): boolean {
	try {
		process.kill(Number(readFileSync(OWNER_FILE, 'utf8').trim()), 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Take the shared-tables test mutex, waiting until the current holder releases it.
 */
export async function acquireDbTestLock(): Promise<void> {
	for (;;) {
		try {
			mkdirSync(LOCK_DIR);
			writeFileSync(OWNER_FILE, String(process.pid));
			return;
		} catch {
			if (!lockOwnerAlive()) {
				rmSync(LOCK_DIR, { recursive: true, force: true });
			}
			await sleep(RETRY_MS);
		}
	}
}

/**
 * Release the shared-tables test mutex.
 */
export function releaseDbTestLock(): void {
	rmSync(LOCK_DIR, { recursive: true, force: true });
}
