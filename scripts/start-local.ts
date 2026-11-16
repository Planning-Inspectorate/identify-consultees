/**
 * Local developer bootstrap: env files, database container, migrate, the Python function (which
 * runs the consultee intersection logic) and the manage app.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Host port 1434 matches docker-compose.yml (avoids clashing with other local SQL Server containers)
const sqlConnectionString =
	'sqlserver://localhost:1434;database=identify-consultees;user=sa;password=DockerDatabaseP@22word!;trustServerCertificate=true';

export async function exists(filePath: string): Promise<boolean> {
	try {
		await access(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Older local setups used host port 1433; compose maps SQL to 1434.
 * Rewrite only the local docker connection strings so migrate/dev can connect.
 */
export async function repairLocalSqlPort(envPath: string): Promise<void> {
	if (!(await exists(envPath))) {
		return;
	}

	const contents = await readFile(envPath, 'utf8');
	const repaired = contents.replaceAll('localhost:1433', 'localhost:1434');
	if (repaired !== contents) {
		await writeFile(envPath, repaired);
		console.log(`Updated SQL host port to 1434 in ${path.relative(root, envPath)}`);
	}
}

const defaultPythonFunctionUrl = 'http://localhost:7071/api/consultee-areas';

/**
 * Older local .env files predate PYTHON_FUNCTION_URL; manage won't start without it.
 */
export async function ensurePythonFunctionUrl(envPath: string): Promise<void> {
	if (!(await exists(envPath))) {
		return;
	}

	const contents = await readFile(envPath, 'utf8');
	if (/^PYTHON_FUNCTION_URL=/m.test(contents)) {
		return;
	}

	const separator = contents.endsWith('\n') ? '' : '\n';
	await writeFile(
		envPath,
		`${contents}${separator}\n# see apps/function-python - local Azure Functions Core Tools default\nPYTHON_FUNCTION_URL=${defaultPythonFunctionUrl}\n`
	);
	console.log(`Added PYTHON_FUNCTION_URL to ${path.relative(root, envPath)}`);
}

export interface LocalEnvPaths {
	databaseEnv: string;
	databaseExample: string;
	manageEnv: string;
	manageExample: string;
}

function defaultEnvPaths(): LocalEnvPaths {
	return {
		databaseEnv: path.join(root, 'packages/database/.env'),
		databaseExample: path.join(root, 'packages/database/.env.example'),
		manageEnv: path.join(root, 'apps/manage/.env'),
		manageExample: path.join(root, 'apps/manage/.env.example')
	};
}

export async function ensureEnvFiles(paths: LocalEnvPaths = defaultEnvPaths()): Promise<void> {
	if (!(await exists(paths.databaseEnv))) {
		await copyFile(paths.databaseExample, paths.databaseEnv);
		console.log('Created packages/database/.env');
	}

	if (!(await exists(paths.manageEnv))) {
		let contents = await readFile(paths.manageExample, 'utf8');
		contents = contents
			.replace(/^AUTH_DISABLED=false$/m, 'AUTH_DISABLED=true')
			.replace(
				/^SQL_CONNECTION_STRING=<populate-SQL-connection-string>$/m,
				`SQL_CONNECTION_STRING="${sqlConnectionString}"`
			);
		await writeFile(paths.manageEnv, contents);
		console.log('Created apps/manage/.env (AUTH_DISABLED=true)');
	}

	await repairLocalSqlPort(paths.databaseEnv);
	await repairLocalSqlPort(paths.manageEnv);
	await ensurePythonFunctionUrl(paths.manageEnv);
}

const functionDir = path.join(root, 'apps/function-python');
const functionPort = 7071;

function venvBinDir(venvDir: string, platform: NodeJS.Platform): string {
	return path.join(venvDir, platform === 'win32' ? 'Scripts' : 'bin');
}

export interface FunctionKeyOptions {
	functionDir: string;
	manageEnv: string;
	/** A stable key source for tests - production draws a fresh random one. */
	randomKey?: () => string;
}

/**
 * The Python function refuses to serve without CONSULTEE_AREAS_API_KEY, and the manage app sends
 * PYTHON_FUNCTION_API_KEY - give both the same local key (an existing one on either side wins).
 */
export async function ensureFunctionApiKey(options: FunctionKeyOptions): Promise<void> {
	const settingsPath = path.join(options.functionDir, 'local.settings.json');
	const manageEnv = options.manageEnv;

	const settings = (await exists(settingsPath))
		? JSON.parse(await readFile(settingsPath, 'utf8'))
		: {
				IsEncrypted: false,
				Values: { FUNCTIONS_WORKER_RUNTIME: 'python', AzureWebJobsStorage: 'UseDevelopmentStorage=true' }
			};
	settings.Values ??= {};
	settings.Values.SQL_CONNECTION_STRING ??= sqlConnectionString;

	const envContents = await readFile(manageEnv, 'utf8');
	const envKey = /^PYTHON_FUNCTION_API_KEY=(.+)$/m.exec(envContents)?.[1]?.trim();
	const key =
		settings.Values.CONSULTEE_AREAS_API_KEY ||
		envKey ||
		(options.randomKey ?? (() => randomBytes(24).toString('hex')))();

	if (settings.Values.CONSULTEE_AREAS_API_KEY !== key) {
		settings.Values.CONSULTEE_AREAS_API_KEY = key;
	}
	await writeFile(settingsPath, `${JSON.stringify(settings, null, '\t')}\n`);

	if (envKey !== key) {
		const separator = envContents.endsWith('\n') ? '' : '\n';
		const updated = envKey
			? envContents.replace(/^PYTHON_FUNCTION_API_KEY=.*$/m, `PYTHON_FUNCTION_API_KEY=${key}`)
			: `${envContents}${separator}PYTHON_FUNCTION_API_KEY=${key}\n`;
		await writeFile(manageEnv, updated);
		console.log('Set a shared local PYTHON_FUNCTION_API_KEY for the manage app and the Python function');
	}
}

export function commandWorks(command: string, args: string[], spawnImpl: typeof spawn = spawn): Promise<boolean> {
	return new Promise((resolve) => {
		const child = spawnImpl(command, args, { stdio: 'ignore', shell: process.platform === 'win32' });
		child.on('error', () => resolve(false));
		child.on('exit', (code) => resolve(code === 0));
	});
}

export interface PythonEnvironmentDeps {
	venvDir: string;
	functionDir: string;
	platform: NodeJS.Platform;
	exists: typeof exists;
	commandWorks: typeof commandWorks;
	run: typeof run;
}

const defaultPythonEnvironmentDeps = (): PythonEnvironmentDeps => ({
	venvDir: path.join(functionDir, '.venv'),
	functionDir,
	platform: process.platform,
	exists,
	commandWorks,
	run
});

/** A Python 3.14 virtual environment (the Function App's runtime) with the function's dependencies. */
export async function ensurePythonEnvironment(overrides: Partial<PythonEnvironmentDeps> = {}): Promise<void> {
	const deps = { ...defaultPythonEnvironmentDeps(), ...overrides };
	const venvBin = venvBinDir(deps.venvDir, deps.platform);
	const pythonExe = deps.platform === 'win32' ? 'python.exe' : 'python';
	if (!(await deps.exists(path.join(venvBin, pythonExe)))) {
		const python = (await deps.commandWorks('python3.14', ['--version'])) ? 'python3.14' : 'python3';
		console.log(`Creating apps/function-python/.venv with ${python}...`);
		await deps.run(python, ['-m', 'venv', deps.venvDir]);
	}
	await deps.run(path.join(venvBin, pythonExe), ['-m', 'pip', 'install', '--quiet', '-r', 'requirements.txt'], {
		cwd: deps.functionDir
	});
}

export interface PythonFunctionDeps {
	functionDir: string;
	venvDir: string;
	functionPort: number;
	platform: NodeJS.Platform;
	commandWorks: typeof commandWorks;
	ensureFunctionApiKey: () => Promise<void>;
	ensurePythonEnvironment: () => Promise<void>;
	spawnImpl: typeof spawn;
	env: NodeJS.ProcessEnv;
}

const defaultPythonFunctionDeps = (): PythonFunctionDeps => ({
	functionDir,
	venvDir: path.join(functionDir, '.venv'),
	functionPort,
	platform: process.platform,
	commandWorks,
	ensureFunctionApiKey: () => ensureFunctionApiKey({ functionDir, manageEnv: path.join(root, 'apps/manage/.env') }),
	ensurePythonEnvironment,
	spawnImpl: spawn,
	env: process.env
});

/**
 * Start the Python function host in the background. If it can't start, the app still runs - its
 * consultee pages say the ruleset couldn't be run - so this warns rather than stopping.
 */
export async function startPythonFunction(
	overrides: Partial<PythonFunctionDeps> = {}
): Promise<ChildProcess | undefined> {
	const deps = { ...defaultPythonFunctionDeps(), ...overrides };
	if (!(await deps.commandWorks('func', ['--version']))) {
		console.warn(
			'Azure Functions Core Tools (`func`) not found - consultee pages will show "The ruleset could not be run".\n' +
				'Install it with `npm install -g azure-functions-core-tools@4`, then run `npm start` again.'
		);
		return undefined;
	}
	try {
		await deps.ensureFunctionApiKey();
		await deps.ensurePythonEnvironment();
	} catch (error) {
		console.warn(
			`Could not set up the Python function (${error instanceof Error ? error.message : String(error)}) - consultee pages will show an error.`
		);
		return undefined;
	}

	console.log(`Starting the Python function on http://localhost:${deps.functionPort} ...`);
	const venvBin = venvBinDir(deps.venvDir, deps.platform);
	const child = deps.spawnImpl('func', ['start', '--port', String(deps.functionPort)], {
		cwd: deps.functionDir,
		stdio: 'inherit',
		shell: deps.platform === 'win32',
		env: { ...deps.env, VIRTUAL_ENV: deps.venvDir, PATH: `${venvBin}${path.delimiter}${deps.env.PATH}` }
	});
	child.on('error', (error) => console.warn(`Python function failed to start: ${error.message}`));
	return child;
}

export function isCleanShutdown(code: number | null, signal: string | null): boolean {
	return signal === 'SIGINT' || signal === 'SIGTERM' || code === 130 || code === 143;
}

export interface RunOptions {
	cwd?: string;
	stdio?: 'inherit' | 'ignore';
	env?: NodeJS.ProcessEnv;
	allowSignalExit?: boolean;
}

export function run(
	command: string,
	args: string[],
	options: RunOptions = {},
	spawnImpl: typeof spawn = spawn
): Promise<void> {
	const { allowSignalExit = false, ...spawnOptions } = options;
	return new Promise((resolve, reject) => {
		const child = spawnImpl(command, args, {
			cwd: root,
			stdio: 'inherit',
			shell: process.platform === 'win32',
			...spawnOptions
		});
		child.on('error', reject);
		child.on('exit', (code, signal) => {
			if (code === 0 || (allowSignalExit && isCleanShutdown(code, signal))) {
				resolve();
			} else {
				reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? signal}`));
			}
		});
	});
}

export function waitForPort(
	port: number,
	host = '127.0.0.1',
	timeoutMs = 120_000,
	retryMs = 1500,
	connectImpl: typeof net.connect = net.connect
): Promise<void> {
	const started = Date.now();
	return new Promise((resolve, reject) => {
		const tryConnect = () => {
			const socket = connectImpl({ port, host }, () => {
				socket.end();
				resolve();
			});
			socket.on('error', () => {
				socket.destroy();
				if (Date.now() - started > timeoutMs) {
					reject(new Error(`Timed out waiting for ${host}:${port}`));
					return;
				}
				setTimeout(tryConnect, retryMs);
			});
		};
		tryConnect();
	});
}

export interface MainDeps {
	ensureEnvFiles: () => Promise<void>;
	run: typeof run;
	waitForPort: typeof waitForPort;
	startPythonFunction: typeof startPythonFunction;
	sleep: (ms: number) => Promise<void>;
}

const defaultMainDeps = (): MainDeps => ({
	ensureEnvFiles,
	run,
	waitForPort,
	startPythonFunction,
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
});

export async function main(overrides: Partial<MainDeps> = {}): Promise<void> {
	const deps = { ...defaultMainDeps(), ...overrides };
	await deps.ensureEnvFiles();

	console.log('Starting database container...');
	await deps.run('docker', ['compose', 'up', '-d']);

	console.log('Waiting for SQL Server on localhost:1434...');
	await deps.waitForPort(1434);

	// SQL Edge can accept TCP before it is ready for logins/migrations.
	await deps.sleep(5000);

	// apply the committed migrations, as CI and the deployed environments do - `prisma migrate dev`
	// is only for writing a new one, and with consultee_area a synonym (see packages/database's
	// README) it would offer to replace the quarter's table with an empty one
	console.log('Running database migrations...');
	await deps.run('npm', ['run', 'db-migrate-prod']);

	console.log('Seeding sample data...');
	await deps.run('npm', ['run', 'db-seed']);

	// stop listeners left over from a previous run - a stale manage app or Python
	// function would keep its port and keep serving the old code instead of this one
	// (the manage app also frees :8090 itself via its prestart hook)
	await deps.run('node', ['scripts/kill-port.ts', '8090', String(functionPort)]);

	const pythonFunction = await deps.startPythonFunction();

	console.log('Starting manage app on http://localhost:8090 ...');
	try {
		await deps.run('npm', ['run', 'dev', '--workspace', 'identify-consultees-manage'], {
			allowSignalExit: true
		});
	} finally {
		pythonFunction?.kill('SIGTERM');
	}
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
