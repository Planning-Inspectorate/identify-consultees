#!/usr/bin/env node
/**
 * Local developer bootstrap: env files, database container, migrate, the Python function (which
 * runs the consultee intersection logic) and the manage app.
 */
import { spawn } from 'node:child_process';
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

async function exists(filePath) {
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
async function repairLocalSqlPort(envPath) {
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
async function ensurePythonFunctionUrl(envPath) {
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

async function ensureEnvFiles() {
	const databaseEnv = path.join(root, 'packages/database/.env');
	const databaseExample = path.join(root, 'packages/database/.env.example');
	const manageEnv = path.join(root, 'apps/manage/.env');
	const manageExample = path.join(root, 'apps/manage/.env.example');

	if (!(await exists(databaseEnv))) {
		await copyFile(databaseExample, databaseEnv);
		console.log('Created packages/database/.env');
	}

	if (!(await exists(manageEnv))) {
		let contents = await readFile(manageExample, 'utf8');
		contents = contents
			.replace(/^AUTH_DISABLED=false$/m, 'AUTH_DISABLED=true')
			.replace(
				/^SQL_CONNECTION_STRING=<populate-SQL-connection-string>$/m,
				`SQL_CONNECTION_STRING="${sqlConnectionString}"`
			);
		await writeFile(manageEnv, contents);
		console.log('Created apps/manage/.env (AUTH_DISABLED=true)');
	}

	await repairLocalSqlPort(databaseEnv);
	await repairLocalSqlPort(manageEnv);
	await ensurePythonFunctionUrl(manageEnv);
}

const functionDir = path.join(root, 'apps/function-python');
const venvDir = path.join(functionDir, '.venv');
const venvBin = path.join(venvDir, process.platform === 'win32' ? 'Scripts' : 'bin');
const functionPort = 7071;

/**
 * The Python function refuses to serve without CONSULTEE_AREAS_API_KEY, and the manage app sends
 * PYTHON_FUNCTION_API_KEY - give both the same local key (an existing one on either side wins).
 */
async function ensureFunctionApiKey() {
	const settingsPath = path.join(functionDir, 'local.settings.json');
	const manageEnv = path.join(root, 'apps/manage/.env');

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
	const key = settings.Values.CONSULTEE_AREAS_API_KEY || envKey || randomBytes(24).toString('hex');

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

function commandWorks(command, args) {
	return new Promise((resolve) => {
		const child = spawn(command, args, { stdio: 'ignore', shell: process.platform === 'win32' });
		child.on('error', () => resolve(false));
		child.on('exit', (code) => resolve(code === 0));
	});
}

/** A Python 3.12 virtual environment (the Function App's runtime) with the function's dependencies. */
async function ensurePythonEnvironment() {
	if (!(await exists(path.join(venvBin, process.platform === 'win32' ? 'python.exe' : 'python')))) {
		const python = (await commandWorks('python3.12', ['--version'])) ? 'python3.12' : 'python3';
		console.log(`Creating apps/function-python/.venv with ${python}...`);
		await run(python, ['-m', 'venv', venvDir]);
	}
	await run(path.join(venvBin, 'python'), ['-m', 'pip', 'install', '--quiet', '-r', 'requirements.txt'], {
		cwd: functionDir
	});
}

/**
 * Start the Python function host in the background. If it can't start, the app still runs - its
 * consultee pages say the ruleset couldn't be run - so this warns rather than stopping.
 */
async function startPythonFunction() {
	if (!(await commandWorks('func', ['--version']))) {
		console.warn(
			'Azure Functions Core Tools (`func`) not found - consultee pages will show "The ruleset could not be run".\n' +
				'Install it with `npm install -g azure-functions-core-tools@4`, then run `npm start` again.'
		);
		return undefined;
	}
	try {
		await ensureFunctionApiKey();
		await ensurePythonEnvironment();
	} catch (error) {
		console.warn(`Could not set up the Python function (${error.message}) - consultee pages will show an error.`);
		return undefined;
	}

	console.log(`Starting the Python function on http://localhost:${functionPort} ...`);
	const child = spawn('func', ['start', '--port', String(functionPort)], {
		cwd: functionDir,
		stdio: 'inherit',
		shell: process.platform === 'win32',
		env: { ...process.env, VIRTUAL_ENV: venvDir, PATH: `${venvBin}${path.delimiter}${process.env.PATH}` }
	});
	child.on('error', (error) => console.warn(`Python function failed to start: ${error.message}`));
	return child;
}

function isCleanShutdown(code, signal) {
	return signal === 'SIGINT' || signal === 'SIGTERM' || code === 130 || code === 143;
}

function run(command, args, options = {}) {
	const { allowSignalExit = false, ...spawnOptions } = options;
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
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

function waitForPort(port, host = '127.0.0.1', timeoutMs = 120_000) {
	const started = Date.now();
	return new Promise((resolve, reject) => {
		const tryConnect = () => {
			const socket = net.connect({ port, host }, () => {
				socket.end();
				resolve();
			});
			socket.on('error', () => {
				socket.destroy();
				if (Date.now() - started > timeoutMs) {
					reject(new Error(`Timed out waiting for ${host}:${port}`));
					return;
				}
				setTimeout(tryConnect, 1500);
			});
		};
		tryConnect();
	});
}

async function main() {
	await ensureEnvFiles();

	console.log('Starting database container...');
	await run('docker', ['compose', 'up', '-d']);

	console.log('Waiting for SQL Server on localhost:1434...');
	await waitForPort(1434);

	// SQL Edge can accept TCP before it is ready for logins/migrations.
	await new Promise((resolve) => setTimeout(resolve, 5000));

	console.log('Running database migrations...');
	await run('npm', ['run', 'db-migrate-dev']);

	console.log('Seeding sample data...');
	await run('npm', ['run', 'db-seed']);

	const pythonFunction = await startPythonFunction();

	console.log('Starting manage app on http://localhost:8090 ...');
	try {
		await run('npm', ['run', 'dev', '--workspace', 'identify-consultees-manage'], {
			allowSignalExit: true
		});
	} finally {
		pythonFunction?.kill('SIGTERM');
	}
}

main().catch((error) => {
	console.error(error.message ?? error);
	process.exit(1);
});
