#!/usr/bin/env node
/**
 * Run nodemon for local develop, treating Ctrl+C / SIGTERM as a clean exit
 * so npm does not print a lifecycle script failure (exit code 130/143).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function isCleanShutdown(code, signal) {
	return signal === 'SIGINT' || signal === 'SIGTERM' || code === 130 || code === 143;
}

const child = spawn(
	'npx',
	['nodemon', '--watch', 'src', '--ext', 'js,ts,scss,html,njk', '--exec', 'npm run start'],
	{
		cwd: appRoot,
		stdio: 'inherit',
		shell: process.platform === 'win32'
	}
);

const forwardSignal = (signal) => {
	if (!child.killed) {
		child.kill(signal);
	}
};

process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));

child.on('error', (error) => {
	console.error(error);
	process.exit(1);
});

child.on('exit', (code, signal) => {
	if (isCleanShutdown(code, signal)) {
		process.exit(0);
	}
	process.exit(code ?? 1);
});
