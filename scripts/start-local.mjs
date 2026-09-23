#!/usr/bin/env node
/**
 * Local developer bootstrap: env files, database container, migrate, manage app.
 */
import { spawn } from 'node:child_process';
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

	console.log('Starting manage app on http://localhost:8090 ...');
	await run('npm', ['run', 'dev', '--workspace', 'identify-consultees-manage'], {
		allowSignalExit: true
	});
}

main().catch((error) => {
	console.error(error.message ?? error);
	process.exit(1);
});
