import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { describe, test } from 'node:test';
import { freePort, listeningPids } from './kill-port.ts';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A TCP port nothing is listening on. */
async function unusedPort(): Promise<number> {
	const probe = net.createServer();
	await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
	const { port } = probe.address() as net.AddressInfo;
	await new Promise<void>((resolve) => probe.close(() => resolve()));
	return port;
}

// the POSIX probe is lsof; skip rather than fail where it isn't installed
// (minimal containers). Windows is covered by the PowerShell branch manually.
const probeAvailable = process.platform === 'win32' || spawnSync('lsof', ['-v']).status === 0;

describe('kill-port', { skip: !probeAvailable }, () => {
	test('freePort stops a process listening on the port', { timeout: 20_000 }, async (t) => {
		const port = await unusedPort();
		const child = spawn(process.execPath, [
			'-e',
			`require('net').createServer().listen(${port}, '0.0.0.0'); setInterval(() => {}, 60000)`
		]);
		t.after(() => child.kill('SIGKILL'));

		for (let i = 0; i < 50 && listeningPids(port).length === 0; i++) {
			await sleep(100);
		}
		assert.ok(listeningPids(port).includes(child.pid), `expected pid ${child.pid} to hold :${port}`);

		const { stopped, free } = await freePort(port);
		assert.equal(stopped.length, 1);
		assert.ok(stopped[0].includes(`pid ${child.pid}`));
		assert.equal(free, true);
		assert.equal(listeningPids(port).length, 0);
	});

	test('freePort is a no-op on a free port', async () => {
		const { stopped, free } = await freePort(await unusedPort());
		assert.deepEqual(stopped, []);
		assert.equal(free, true);
	});
});
