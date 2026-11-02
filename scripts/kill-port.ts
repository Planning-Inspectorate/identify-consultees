/**
 * Free localhost ports before a dev server binds them: stop whatever is already
 * listening - almost always a leftover process from an earlier `npm start` /
 * `npm run dev` that nodemon lost track of. No-op when the port is already free.
 *
 * Usage: kill-port.ts [port ...] - with no args it frees the manage app's HTTP
 * port: the PORT env var, defaulting to 8090 like apps/manage's config does.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_HTTP_PORT = 8090;
const SIGKILL_GRACE_MS = 2_000;
const FREE_TIMEOUT_MS = 5_000;
const POLL_MS = 150;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** PIDs holding a TCP listener on the port; empty when free or the probe tool is missing. */
export function listeningPids(port: number): number[] {
	const result =
		process.platform === 'win32'
			? spawnSync(
					'powershell',
					[
						'-NoProfile',
						'-Command',
						`(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique`
					],
					{ encoding: 'utf8' }
				)
			: spawnSync('lsof', ['-nP', `-tiTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });

	if (result.error || result.status === null) {
		return [];
	}

	const pids = (result.stdout ?? '')
		.split(/\s+/)
		.map(Number)
		.filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
	return [...new Set(pids)];
}

/** Best-effort command label for a log line ('node src/server.ts'); empty when unavailable. */
function commandFor(pid: number): string {
	if (process.platform === 'win32') {
		return '';
	}
	const result = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
	return (result.stdout ?? '').trim().slice(0, 80);
}

export type FreedPort = { port: number; stopped: string[]; free: boolean };

/**
 * SIGTERM every listener on the port, escalating to SIGKILL for stragglers, and
 * wait until nothing listens (or FREE_TIMEOUT_MS elapses). `stopped` is a log
 * label per killed process ('command [pid]').
 */
export async function freePort(port: number): Promise<FreedPort> {
	const pids = listeningPids(port);
	const stopped = pids.map((pid) => {
		const command = commandFor(pid);
		return command ? `'${command}' [pid ${pid}]` : `pid ${pid}`;
	});

	for (const pid of pids) {
		try {
			process.kill(pid, 'SIGTERM');
		} catch {
			// already exited between listing and signalling
		}
	}

	const started = Date.now();
	let remaining = listeningPids(port);
	while (remaining.length > 0 && Date.now() - started < FREE_TIMEOUT_MS) {
		if (Date.now() - started > SIGKILL_GRACE_MS) {
			for (const pid of remaining) {
				try {
					process.kill(pid, 'SIGKILL');
				} catch {
					// already exited
				}
			}
		}
		await sleep(POLL_MS);
		remaining = listeningPids(port);
	}

	return { port, stopped, free: remaining.length === 0 };
}

/** Free each port in turn; returns false when any port is still held. */
export async function freePorts(ports: number[]): Promise<boolean> {
	let allFree = true;
	for (const port of ports) {
		const { stopped, free } = await freePort(port);
		if (stopped.length > 0) {
			console.log(`Freed :${port} (stopped ${stopped.join(', ')})`);
		}
		if (!free) {
			allFree = false;
			console.warn(`:${port} is still in use - the server may fail to start with EADDRINUSE`);
		}
	}
	return allFree;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const ports = process.argv
		.slice(2)
		.map(Number)
		.filter((port) => Number.isInteger(port) && port > 0);
	const targets = ports.length > 0 ? ports : [Number(process.env.PORT) || DEFAULT_HTTP_PORT];
	freePorts(targets).catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
