import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, mock, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	commandWorks,
	ensureEnvFiles,
	ensureFunctionApiKey,
	ensurePythonEnvironment,
	ensurePythonFunctionUrl,
	exists,
	isCleanShutdown,
	main,
	repairLocalSqlPort,
	run,
	startPythonFunction,
	waitForPort
} from './start-local.ts';

function withTempDir(fn: (dir: string) => void | Promise<void>) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-local-test-'));
	return Promise.resolve(fn(dir)).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

/**
 * A spawned-process stand-in that emits 'exit' (or 'error') on the next tick.
 */
function fakeChild(outcome: { code?: number | null; signal?: string | null; error?: unknown }): ChildProcess {
	const child = new EventEmitter() as ChildProcess;
	(child as { kill: () => boolean }).kill = () => true;
	queueMicrotask(() => {
		if ('error' in outcome) {
			child.emit('error', outcome.error);
		} else {
			child.emit('exit', 'code' in outcome ? outcome.code : 0, outcome.signal ?? null);
		}
	});
	return child;
}

function fakeSpawn(outcome: { code?: number | null; signal?: string | null; error?: unknown }): typeof spawn {
	return ((command: string, args: string[], options: object) =>
		Object.assign(fakeChild(outcome), { spawned: { command, args, options } })) as typeof spawn;
}

describe('exists', () => {
	test('is true for a real file and false otherwise', async () => {
		await withTempDir(async (dir) => {
			const filePath = path.join(dir, 'file');
			fs.writeFileSync(filePath, 'x');
			assert.equal(await exists(filePath), true);
			assert.equal(await exists(path.join(dir, 'missing')), false);
		});
	});
});

describe('repairLocalSqlPort', () => {
	test('is a no-op when the env file does not exist', async () => {
		await repairLocalSqlPort(path.join(os.tmpdir(), 'start-local-no-such-env'));
	});

	test('leaves a file with no :1433 references untouched', async () => {
		await withTempDir(async (dir) => {
			const envPath = path.join(dir, '.env');
			fs.writeFileSync(envPath, 'SQL=localhost:1434\n');
			await repairLocalSqlPort(envPath);
			assert.equal(fs.readFileSync(envPath, 'utf8'), 'SQL=localhost:1434\n');
		});
	});

	test('rewrites localhost:1433 to :1434 and says so', async () => {
		const log = mock.method(console, 'log', () => {});
		try {
			await withTempDir(async (dir) => {
				const envPath = path.join(dir, '.env');
				fs.writeFileSync(envPath, 'A=localhost:1433\nB=sqlserver://localhost:1433;x\n');
				await repairLocalSqlPort(envPath);
				assert.equal(fs.readFileSync(envPath, 'utf8'), 'A=localhost:1434\nB=sqlserver://localhost:1434;x\n');
			});
			assert.equal(log.mock.callCount(), 1);
			assert.match(log.mock.calls[0].arguments[0] as string, /Updated SQL host port to 1434/);
		} finally {
			log.mock.restore();
		}
	});
});

describe('ensurePythonFunctionUrl', () => {
	test('is a no-op for a missing file or one that already has the key', async () => {
		await withTempDir(async (dir) => {
			await ensurePythonFunctionUrl(path.join(dir, 'missing'));

			const envPath = path.join(dir, '.env');
			fs.writeFileSync(envPath, 'PYTHON_FUNCTION_URL=http://custom\n');
			await ensurePythonFunctionUrl(envPath);
			assert.equal(fs.readFileSync(envPath, 'utf8'), 'PYTHON_FUNCTION_URL=http://custom\n');
		});
	});

	test('appends the default URL with correct separators', async () => {
		await withTempDir(async (dir) => {
			const withNewline = path.join(dir, 'a.env');
			fs.writeFileSync(withNewline, 'OTHER=1\n');
			await ensurePythonFunctionUrl(withNewline);
			assert.match(
				fs.readFileSync(withNewline, 'utf8'),
				/^OTHER=1\n\n# see apps\/function-python[\s\S]*PYTHON_FUNCTION_URL=http:\/\/localhost:7071\/api\/consultee-areas\n$/
			);

			const noNewline = path.join(dir, 'b.env');
			fs.writeFileSync(noNewline, 'OTHER=1');
			await ensurePythonFunctionUrl(noNewline);
			const contents = fs.readFileSync(noNewline, 'utf8');
			assert.ok(contents.startsWith('OTHER=1\n\n'));
			assert.ok(contents.includes('PYTHON_FUNCTION_URL=http://localhost:7071/api/consultee-areas\n'));
		});
	});
});

describe('ensureEnvFiles', () => {
	function envPaths(dir: string) {
		return {
			databaseEnv: path.join(dir, 'db.env'),
			databaseExample: path.join(dir, 'db.example'),
			manageEnv: path.join(dir, 'manage.env'),
			manageExample: path.join(dir, 'manage.example')
		};
	}

	const exampleContents = 'AUTH_DISABLED=false\nSQL_CONNECTION_STRING=<populate-SQL-connection-string>\n';

	test('copies the database example and writes manage .env with local values', async () => {
		await withTempDir(async (dir) => {
			const paths = envPaths(dir);
			fs.writeFileSync(paths.databaseExample, 'DB_EXAMPLE=1\n');
			fs.writeFileSync(paths.manageExample, exampleContents);
			await ensureEnvFiles(paths);
			assert.equal(fs.readFileSync(paths.databaseEnv, 'utf8'), 'DB_EXAMPLE=1\n');
			const manage = fs.readFileSync(paths.manageEnv, 'utf8');
			assert.ok(manage.includes('AUTH_DISABLED=true'));
			assert.ok(manage.includes('SQL_CONNECTION_STRING="sqlserver://localhost:1434;'));
			assert.ok(manage.includes('PYTHON_FUNCTION_URL=http://localhost:7071/api/consultee-areas'));
		});
	});

	test('leaves existing env files alone, keeps placeholders that do not match, and repairs 1433', async () => {
		await withTempDir(async (dir) => {
			const paths = envPaths(dir);
			fs.writeFileSync(paths.databaseEnv, 'OLD=localhost:1433\n');
			fs.writeFileSync(paths.manageEnv, 'AUTH_DISABLED=unset\nSQL_CONNECTION_STRING=localhost:1433\n');
			await ensureEnvFiles(paths);
			assert.equal(fs.readFileSync(paths.databaseEnv, 'utf8'), 'OLD=localhost:1434\n');
			const manage = fs.readFileSync(paths.manageEnv, 'utf8');
			assert.ok(manage.includes('AUTH_DISABLED=unset'));
			assert.ok(manage.includes('SQL_CONNECTION_STRING=localhost:1434'));
		});
	});
});

describe('ensureFunctionApiKey', () => {
	const FIXED_KEY = 'ab'.repeat(24);

	function keyPaths(dir: string) {
		const functionDir = path.join(dir, 'function');
		fs.mkdirSync(functionDir, { recursive: true });
		return {
			functionDir,
			manageEnv: path.join(dir, 'manage.env'),
			settingsPath: path.join(functionDir, 'local.settings.json')
		};
	}

	test('an existing key in local.settings.json wins over the env one', async () => {
		await withTempDir(async (dir) => {
			const { functionDir, manageEnv, settingsPath } = keyPaths(dir);
			fs.writeFileSync(
				settingsPath,
				JSON.stringify({ Values: { CONSULTEE_AREAS_API_KEY: 'settings-key', SQL_CONNECTION_STRING: 'custom' } })
			);
			fs.writeFileSync(manageEnv, 'PYTHON_FUNCTION_API_KEY=env-key\n');
			await ensureFunctionApiKey({ functionDir, manageEnv, randomKey: () => FIXED_KEY });
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
			assert.equal(settings.Values.CONSULTEE_AREAS_API_KEY, 'settings-key');
			assert.equal(settings.Values.SQL_CONNECTION_STRING, 'custom');
			assert.equal(fs.readFileSync(manageEnv, 'utf8'), 'PYTHON_FUNCTION_API_KEY=settings-key\n');
		});
	});

	test('the env key is reused when settings have none, creating a settings file if needed', async () => {
		await withTempDir(async (dir) => {
			const { functionDir, manageEnv, settingsPath } = keyPaths(dir);
			fs.writeFileSync(manageEnv, 'PYTHON_FUNCTION_API_KEY=env-key\n');
			await ensureFunctionApiKey({ functionDir, manageEnv });
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
			assert.equal(settings.IsEncrypted, false);
			assert.equal(settings.Values.FUNCTIONS_WORKER_RUNTIME, 'python');
			assert.equal(settings.Values.CONSULTEE_AREAS_API_KEY, 'env-key');
			assert.equal(fs.readFileSync(manageEnv, 'utf8'), 'PYTHON_FUNCTION_API_KEY=env-key\n');
		});
	});

	test('a settings file without a Values map gets one, and a random key when nothing exists', async () => {
		await withTempDir(async (dir) => {
			const { functionDir, manageEnv, settingsPath } = keyPaths(dir);
			fs.writeFileSync(settingsPath, JSON.stringify({ IsEncrypted: false }));
			fs.writeFileSync(manageEnv, 'OTHER=1');
			await ensureFunctionApiKey({ functionDir, manageEnv, randomKey: () => FIXED_KEY });
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
			assert.equal(settings.Values.CONSULTEE_AREAS_API_KEY, FIXED_KEY);
			assert.ok(settings.Values.SQL_CONNECTION_STRING.startsWith('sqlserver://localhost:1434'));
			const env = fs.readFileSync(manageEnv, 'utf8');
			assert.equal(env, `OTHER=1\nPYTHON_FUNCTION_API_KEY=${FIXED_KEY}\n`);
		});
	});

	test('the default key source is a fresh random hex key', async () => {
		await withTempDir(async (dir) => {
			const { functionDir, manageEnv, settingsPath } = keyPaths(dir);
			fs.writeFileSync(manageEnv, '\n');
			await ensureFunctionApiKey({ functionDir, manageEnv });
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
			assert.match(settings.Values.CONSULTEE_AREAS_API_KEY, /^[0-9a-f]{48}$/);
		});
	});
});

describe('commandWorks', () => {
	test('is true when the command exits 0, false otherwise or when it cannot spawn', async () => {
		assert.equal(await commandWorks('anything', [], fakeSpawn({ code: 0 })), true);
		assert.equal(await commandWorks('anything', [], fakeSpawn({ code: 1 })), false);
		assert.equal(await commandWorks('anything', [], fakeSpawn({ error: new Error('ENOENT') })), false);
	});

	test('uses a shell only on Windows', async () => {
		const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
		Object.defineProperty(process, 'platform', { value: 'win32' });
		try {
			const seen: object[] = [];
			const spawnSpy = ((command: string, args: string[], options: object) => {
				seen.push(options);
				return fakeChild({ code: 0 });
			}) as typeof spawn;
			await commandWorks('anything', [], spawnSpy);
			assert.equal((seen[0] as { shell: boolean }).shell, true);
		} finally {
			Object.defineProperty(process, 'platform', platform);
		}
	});
});

describe('ensurePythonEnvironment', () => {
	function pythonDeps(dir: string, overrides: Record<string, unknown> = {}) {
		const calls: string[] = [];
		return {
			deps: {
				venvDir: path.join(dir, '.venv'),
				functionDir: dir,
				platform: 'linux',
				exists: async () => false,
				commandWorks: async () => true,
				run: async (command: string, args: string[]) => calls.push(`${command} ${args.join(' ')}`),
				...overrides
			},
			calls
		};
	}

	test('creates the venv with python3.14 when available, then installs requirements', async () => {
		await withTempDir(async (dir) => {
			const { deps, calls } = pythonDeps(dir);
			await ensurePythonEnvironment(deps);
			assert.match(calls[0], /^python3\.14 -m venv /);
			assert.match(calls[1], /-m pip install --quiet -r requirements\.txt$/);
		});
	});

	test('falls back to python3 when python3.14 is not installed', async () => {
		await withTempDir(async (dir) => {
			const { deps, calls } = pythonDeps(dir, { commandWorks: async () => false });
			await ensurePythonEnvironment(deps);
			assert.match(calls[0], /^python3 -m venv /);
		});
	});

	test('skips venv creation when the interpreter already exists, on Windows too', async () => {
		await withTempDir(async (dir) => {
			const { deps, calls } = pythonDeps(dir, { exists: async () => true, platform: 'win32' });
			await ensurePythonEnvironment(deps);
			assert.equal(calls.length, 1);
			assert.match(calls[0], /Scripts.*python\.exe -m pip install/);
		});
	});
});

describe('startPythonFunction', () => {
	function functionDeps(overrides: Record<string, unknown> = {}) {
		return {
			functionDir: '/fn',
			venvDir: '/fn/.venv',
			functionPort: 7071,
			platform: 'linux',
			commandWorks: async () => true,
			ensureFunctionApiKey: async () => {},
			ensurePythonEnvironment: async () => {},
			spawnImpl: fakeSpawn({ code: 0 }),
			env: { PATH: '/usr/bin' } as NodeJS.ProcessEnv,
			...overrides
		};
	}

	test('warns and returns nothing when Azure Functions Core Tools are missing', async () => {
		const warn = mock.method(console, 'warn', () => {});
		try {
			const child = await startPythonFunction(functionDeps({ commandWorks: async () => false }));
			assert.equal(child, undefined);
			assert.ok(warn.mock.calls.some((call) => (call.arguments[0] as string).includes('Core Tools')));
		} finally {
			warn.mock.restore();
		}
	});

	test('warns and returns nothing when setup fails, for errors and non-errors', async () => {
		const warn = mock.method(console, 'warn', () => {});
		try {
			for (const failure of [new Error('venv broke'), 'plain string']) {
				const child = await startPythonFunction(
					functionDeps({ ensureFunctionApiKey: async () => Promise.reject(failure) })
				);
				assert.equal(child, undefined);
			}
			assert.equal(warn.mock.callCount(), 2);
			assert.ok((warn.mock.calls[0].arguments[0] as string).includes('venv broke'));
			assert.ok((warn.mock.calls[1].arguments[0] as string).includes('plain string'));
		} finally {
			warn.mock.restore();
		}
	});

	test('spawns func with the venv on PATH and warns if the child errors', async () => {
		const warn = mock.method(console, 'warn', () => {});
		try {
			let spawned: { command: string; args: string[]; options: Record<string, unknown> } | undefined;
			const child = new EventEmitter() as ChildProcess;
			const spawnSpy = ((command: string, args: string[], options: object) => {
				spawned = { command, args, options: options as Record<string, unknown> };
				return child;
			}) as typeof spawn;
			const result = await startPythonFunction(functionDeps({ spawnImpl: spawnSpy, platform: 'win32' }));
			assert.equal(result, child);
			assert.equal(spawned!.command, 'func');
			assert.deepEqual(spawned!.args, ['start', '--port', '7071']);
			assert.equal((spawned!.options as { shell: boolean }).shell, true);
			const env = spawned!.options.env as NodeJS.ProcessEnv;
			assert.equal(env.VIRTUAL_ENV, '/fn/.venv');
			assert.ok(env.PATH!.includes('Scripts'));
			child.emit('error', new Error('spawn func ENOENT'));
			assert.ok(
				warn.mock.calls.some((call) => (call.arguments[0] as string).includes('Python function failed to start'))
			);
		} finally {
			warn.mock.restore();
		}
	});
});

describe('isCleanShutdown', () => {
	test('treats Ctrl+C / SIGTERM codes as clean', () => {
		assert.equal(isCleanShutdown(null, 'SIGINT'), true);
		assert.equal(isCleanShutdown(null, 'SIGTERM'), true);
		assert.equal(isCleanShutdown(130, null), true);
		assert.equal(isCleanShutdown(143, null), true);
		assert.equal(isCleanShutdown(1, null), false);
	});
});

describe('run', () => {
	test('resolves on exit 0 and rejects otherwise, naming the command', async () => {
		await run('ok', [], {}, fakeSpawn({ code: 0 }));
		await assert.rejects(run('bad', ['-x'], {}, fakeSpawn({ code: 2 })), /bad -x exited with code 2/);
	});

	test('rejects on spawn error and on signal exits unless allowed', async () => {
		await assert.rejects(run('x', [], {}, fakeSpawn({ error: new Error('spawn ENOENT') })), /spawn ENOENT/);
		await assert.rejects(
			run('x', [], { allowSignalExit: true }, fakeSpawn({ code: null, signal: 'SIGKILL' })),
			/exited with code SIGKILL/
		);
		await assert.rejects(run('x', [], {}, fakeSpawn({ code: null, signal: 'SIGINT' })), /exited with code SIGINT/);
		await run('x', [], { allowSignalExit: true }, fakeSpawn({ code: null, signal: 'SIGINT' }));
	});

	test('passes cwd/stdio/env through, with a shell on Windows', async () => {
		const seen: Record<string, unknown>[] = [];
		const spawnSpy = ((command: string, args: string[], options: object) => {
			seen.push(options as Record<string, unknown>);
			return fakeChild({ code: 0 });
		}) as typeof spawn;
		await run('x', [], { cwd: '/somewhere', env: { A: '1' } }, spawnSpy);
		assert.equal(seen[0].cwd, '/somewhere');
		assert.equal(seen[0].stdio, 'inherit');

		const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
		Object.defineProperty(process, 'platform', { value: 'win32' });
		try {
			await run('x', [], {}, spawnSpy);
			assert.equal((seen[1] as { shell: boolean }).shell, true);
		} finally {
			Object.defineProperty(process, 'platform', platform);
		}
	});
});

describe('waitForPort', () => {
	function fakeSocket(emitError: boolean): net.Socket {
		const socket = new EventEmitter() as net.Socket;
		(socket as { end: () => void }).end = () => {};
		(socket as { destroy: () => void }).destroy = () => {};
		queueMicrotask(() => emitError && socket.emit('error', new Error('ECONNREFUSED')));
		return socket;
	}

	test('resolves once the port answers', async () => {
		const server = net.createServer();
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const port = (server.address() as net.AddressInfo).port;
		try {
			await waitForPort(port, '127.0.0.1', 5_000);
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	test('retries until the port answers, then resolves', async () => {
		let attempts = 0;
		const connectImpl = ((options: net.NetConnectOpts, onConnect: () => void) => {
			attempts += 1;
			const socket = fakeSocket(attempts === 1);
			if (attempts > 1) queueMicrotask(onConnect);
			return socket;
		}) as typeof net.connect;
		await waitForPort(1234, '127.0.0.1', 5_000, 1, connectImpl);
		assert.equal(attempts > 1, true);
	});

	test('rejects after the timeout when the port never answers', async () => {
		const connectImpl = (() => fakeSocket(true)) as typeof net.connect;
		await assert.rejects(waitForPort(1234, '127.0.0.1', 10, 1, connectImpl), /Timed out waiting for 127\.0\.0\.1:1234/);
	});
});

describe('main', () => {
	function mainDeps(overrides: Record<string, unknown> = {}) {
		const calls: string[] = [];
		return {
			deps: {
				ensureEnvFiles: async () => calls.push('env'),
				run: async (command: string, args: string[]) => calls.push(`${command} ${args.join(' ')}`),
				waitForPort: async (port: number) => calls.push(`wait ${port}`),
				startPythonFunction: async () => {
					calls.push('python-function');
					return fakeChild({ code: 0 });
				},
				sleep: async () => calls.push('sleep'),
				...overrides
			},
			calls
		};
	}

	test('runs the bring-up in order and stops the Python function when the app exits', async () => {
		const log = mock.method(console, 'log', () => {});
		try {
			const child = fakeChild({ code: 0 });
			const killSpy = mock.method(child, 'kill', () => true);
			const { deps: custom, calls: customCalls } = mainDeps({ startPythonFunction: async () => child });
			await main(custom);
			assert.deepEqual(customCalls.slice(0, 7), [
				'env',
				'docker compose up -d',
				'wait 1434',
				'sleep',
				'npm run db-migrate-prod',
				'npm run db-seed',
				'node scripts/kill-port.ts 8090 7071'
			]);
			assert.equal(killSpy.mock.callCount(), 1);
			assert.equal(killSpy.mock.calls[0].arguments[0], 'SIGTERM');
		} finally {
			log.mock.restore();
		}
	});

	test('still stops the Python function when the app fails, and skips it when it never started', async () => {
		const log = mock.method(console, 'log', () => {});
		try {
			const child = fakeChild({ code: 0 });
			const killSpy = mock.method(child, 'kill', () => true);
			const { deps } = mainDeps({
				startPythonFunction: async () => child,
				run: async (command: string, args: string[]) => {
					if (args.includes('dev')) throw new Error('dev crashed');
				}
			});
			await assert.rejects(main(deps), /dev crashed/);
			assert.equal(killSpy.mock.callCount(), 1);

			const { deps: noFunction } = mainDeps({ startPythonFunction: async () => undefined });
			await main(noFunction);
		} finally {
			log.mock.restore();
		}
	});
});

// the isMain block only runs as a script, so these tests spawn the real CLI in a child
// process with the outside world mocked - child coverage still counts towards this file
const cliPath = fileURLToPath(new URL('./start-local.ts', import.meta.url));
const cliUrl = pathToFileURL(cliPath).href;

function runHarness(harness: string, env: NodeJS.ProcessEnv = {}) {
	try {
		const stdout = execFileSync(
			process.execPath,
			['--experimental-test-module-mocks', '--input-type=module', '--experimental-strip-types', '--eval', harness],
			{ encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60_000 }
		);
		return { stdout, status: 0, stderr: '' };
	} catch (error) {
		const failure = error as { status: number; stdout: string; stderr: string };
		return { stdout: failure.stdout ?? '', status: failure.status, stderr: failure.stderr ?? '' };
	}
}

/**
 * Module mocks making every spawned command exit 0 instantly, every TCP connect
 * succeed, and the filesystem an empty stub - so main() runs end-to-end without
 * touching the real repo, docker or the network.
 */
const FULL_MOCKS = `
	const { mock } = await import('node:test');
	const { EventEmitter } = await import('node:events');
	const child = () => {
		const c = new EventEmitter();
		c.kill = () => true;
		queueMicrotask(() => c.emit('exit', 0, null));
		return c;
	};
	mock.module('node:child_process', { exports: { spawn: child } });
	mock.module('node:fs/promises', {
		exports: {
			access: () => Promise.reject(new Error('ENOENT')),
			copyFile: async () => {},
			readFile: async () => 'AUTH_DISABLED=false\\nSQL_CONNECTION_STRING=<populate-SQL-connection-string>\\n',
			writeFile: async () => {}
		}
	});
	mock.module('node:net', {
		exports: {
			default: {
				connect: (options, onConnect) => {
					const s = new EventEmitter();
					s.end = () => {};
					s.destroy = () => {};
					queueMicrotask(onConnect);
					return s;
				}
			}
		}
	});
`;

describe('running as a script', () => {
	test('brings the whole local stack up when every command succeeds', { timeout: 90_000 }, () => {
		const harness = `
			${FULL_MOCKS}
			process.argv[1] = ${JSON.stringify(cliPath)};
			await import(${JSON.stringify(cliUrl)});
		`;
		const result = runHarness(harness);
		assert.equal(result.status, 0);
		assert.match(result.stdout, /Starting database container/);
		assert.match(result.stdout, /Starting manage app/);
	});

	test('exits non-zero when a bring-up command fails', () => {
		const harness = `
			${FULL_MOCKS.replace(/emit\('exit', 0, null\)/, "emit('exit', 1, null)")}
			process.argv[1] = ${JSON.stringify(cliPath)};
			await import(${JSON.stringify(cliUrl)});
		`;
		const result = runHarness(harness);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /exited with code 1/);
	});

	test('exits non-zero with the thrown value when it is not an Error', () => {
		const harness = `
			const { mock } = await import('node:test');
			const { EventEmitter } = await import('node:events');
			mock.module('node:child_process', {
				exports: { spawn: () => { const c = new EventEmitter(); queueMicrotask(() => c.emit('error', 'spawn broke')); return c; } }
			});
			mock.module('node:fs/promises', {
				exports: {
					access: () => Promise.reject(new Error('ENOENT')),
					copyFile: async () => {},
					readFile: async () => '',
					writeFile: async () => {}
				}
			});
			process.argv[1] = ${JSON.stringify(cliPath)};
			await import(${JSON.stringify(cliUrl)});
		`;
		const result = runHarness(harness);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /spawn broke/);
	});
});
