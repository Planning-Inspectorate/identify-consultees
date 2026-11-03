import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { freePort, freePorts, listeningPids } from './kill-port.ts';

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

	test('listeningPids is empty when the probe cannot run or reports nothing', () => {
		const failed = (() => ({ error: new Error('spawn lsof ENOENT') })) as typeof spawnSync;
		assert.deepEqual(listeningPids(8080, failed), []);
		const silent = (() => ({ status: 0 })) as typeof spawnSync;
		assert.deepEqual(listeningPids(8080, silent), []);
	});

	test('freePort escalates to SIGKILL for a listener that will not die', { timeout: 20_000 }, async () => {
		// a pid above Linux's 4194304 pid_max (and macOS's 99998), so process.kill reliably throws -
		// the listener vanished between listing and signalling. The probe keeps reporting it, so the
		// SIGKILL sweep and the timeout run too
		const spawnMock = ((command: string) =>
			command === 'lsof' ? { status: 0, stdout: '4194305' } : { status: 0 }) as typeof spawnSync;
		const { stopped, free } = await freePort(4000, spawnMock);
		assert.deepEqual(stopped, ['pid 4194305']);
		assert.equal(free, false);
	});

	test('freePort reads PowerShell output on Windows, with no command line to log', async () => {
		const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
		Object.defineProperty(process, 'platform', { value: 'win32' });
		try {
			const commands: string[] = [];
			let probes = 0;
			const spawnMock = ((command: string) => {
				commands.push(command);
				return { status: 0, stdout: probes++ === 0 ? '4194305' : '' };
			}) as typeof spawnSync;

			const { stopped, free } = await freePort(4001, spawnMock);

			assert.equal(commands[0], 'powershell');
			assert.deepEqual(stopped, ['pid 4194305']);
			assert.equal(free, true);
		} finally {
			Object.defineProperty(process, 'platform', platform);
		}
	});

	test('freePorts logs what it stopped', { timeout: 20_000 }, async (t) => {
		const port = await unusedPort();
		const child = spawn(process.execPath, [
			'-e',
			`require('net').createServer().listen(${port}, '0.0.0.0'); setInterval(() => {}, 60000)`
		]);
		t.after(() => child.kill('SIGKILL'));

		for (let i = 0; i < 50 && listeningPids(port).length === 0; i++) {
			await sleep(100);
		}

		const logged: string[] = [];
		t.mock.method(console, 'log', (line: string) => logged.push(line));
		assert.equal(await freePorts([port]), true);
		assert.ok(logged.some((line) => line.includes(`Freed :${port}`)));
	});

	test('freePorts warns and returns false for a port still held', { timeout: 20_000 }, async (t) => {
		const spawnMock = ((command: string) =>
			command === 'lsof' ? { status: 0, stdout: '4194305' } : { status: 0 }) as typeof spawnSync;
		const warned: string[] = [];
		t.mock.method(console, 'log', () => undefined);
		t.mock.method(console, 'warn', (line: string) => warned.push(line));

		assert.equal(await freePorts([4002], spawnMock), false);
		assert.ok(warned.some((line) => line.includes('still in use')));
	});
});

// the isMain block only runs as a script, so these tests spawn the real CLI in a child process -
// child coverage still counts towards this file's numbers
const cliPath = fileURLToPath(new URL('./kill-port.ts', import.meta.url));

describe('running as a script', () => {
	test('frees the ports it is given, ignoring arguments that are not ports', async () => {
		const port = await unusedPort();
		execFileSync(process.execPath, ['--experimental-strip-types', cliPath, 'not-a-port', String(port)], {
			encoding: 'utf8'
		});
	});

	test("frees the PORT env var's port, defaulting to 8090, with no arguments", async () => {
		const port = await unusedPort();
		execFileSync(process.execPath, ['--experimental-strip-types', cliPath, 'not-a-port'], {
			encoding: 'utf8',
			env: { ...process.env, PORT: String(port) }
		});
		const env = { ...process.env };
		delete env.PORT;
		execFileSync(process.execPath, ['--experimental-strip-types', cliPath], { encoding: 'utf8', env });
	});

	test('exits non-zero when the ports cannot be probed', () => {
		// spawnSync throwing makes freePorts reject, exercising the script's .catch
		const harness = `
			const { mock } = await import('node:test');
			mock.module('node:child_process', { namedExports: { spawnSync: () => { throw new Error('spawn broke'); } } });
			process.argv[1] = ${JSON.stringify(cliPath)};
			process.argv.push('8080');
			await import(${JSON.stringify(pathToFileURL(cliPath).href)});
		`;
		try {
			execFileSync(
				process.execPath,
				['--experimental-test-module-mocks', '--input-type=module', '--experimental-strip-types', '--eval', harness],
				{ encoding: 'utf8' }
			);
			assert.fail('expected the script to exit non-zero');
		} catch (error) {
			const failure = error as { status: number; stderr: string };
			assert.equal(failure.status, 1);
			assert.match(failure.stderr, /spawn broke/);
		}
	});
});
