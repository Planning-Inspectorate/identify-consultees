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

const sqlConnectionString =
	'sqlserver://localhost:1433;database=identify-consultees;user=sa;password=DockerDatabaseP@22word!;trustServerCertificate=true';

async function exists(filePath) {
	try {
		await access(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
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
}

function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: root,
			stdio: 'inherit',
			shell: process.platform === 'win32',
			...options
		});
		child.on('error', reject);
		child.on('exit', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
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

	console.log('Waiting for SQL Server on localhost:1433...');
	await waitForPort(1433);

	// SQL Edge can accept TCP before it is ready for logins/migrations.
	await new Promise((resolve) => setTimeout(resolve, 5000));

	console.log('Running database migrations...');
	await run('npm', ['run', 'db-migrate-dev']);

	console.log('Starting manage app on http://localhost:8090 ...');
	await run('npm', ['run', 'dev', '--workspace', 'identify-consultees-manage']);
}

main().catch((error) => {
	console.error(error.message ?? error);
	process.exit(1);
});
