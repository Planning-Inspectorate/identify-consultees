#!/usr/bin/env node
/**
 * Guardrail so local installs stay aligned with Azure Pipelines `npm ci`.
 *
 * CI (`.azure/pipelines/*` via PINS `node_script.yml`) uses Node 22.23.2, which
 * ships npm 10.9.8. Regenerating the lockfile with Node 24 / npm 11 (or other
 * majors) can drop Prisma Studio peer entries (`react` / `react-dom` /
 * `scheduler`) and break `npm ci` — see PR #53 / commit 2e4f99d.
 *
 * Set SKIP_TOOLCHAIN_CHECK=1 to bypass (emergencies only).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REQUIRED_NODE = '22.23.2';
const REQUIRED_NPM = '10.9.8';

/** Lockfile package keys that must remain present for `npm ci` (Prisma Studio / Radix peers). */
const REQUIRED_LOCKFILE_PEERS = ['node_modules/react', 'node_modules/react-dom', 'node_modules/scheduler'];

if (process.env.SKIP_TOOLCHAIN_CHECK === '1') {
	process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

function versionParts(version) {
	return String(version)
		.replace(/^v/, '')
		.split('.')
		.map((part) => Number.parseInt(part, 10));
}

function versionsEqual(actual, expected) {
	const a = versionParts(actual);
	const e = versionParts(expected);
	return a[0] === e[0] && a[1] === e[1] && a[2] === e[2];
}

const nodeVersion = process.versions.node;
if (!versionsEqual(nodeVersion, REQUIRED_NODE)) {
	errors.push(
		`Node ${nodeVersion} does not match required ${REQUIRED_NODE} (see .nvmrc / Azure Pipelines). Run: nvm install && nvm use`
	);
}

const npmVersion = process.env.npm_config_user_agent?.match(/npm\/(\d+\.\d+\.\d+)/)?.[1] || process.env.npm_version;
let resolvedNpm = npmVersion;
if (!resolvedNpm) {
	try {
		const { execFileSync } = await import('node:child_process');
		resolvedNpm = execFileSync('npm', ['-v'], { encoding: 'utf8' }).trim();
	} catch {
		resolvedNpm = undefined;
	}
}

if (!resolvedNpm || !versionsEqual(resolvedNpm, REQUIRED_NPM)) {
	errors.push(
		`npm ${resolvedNpm || '(unknown)'} does not match required ${REQUIRED_NPM}. Use Node ${REQUIRED_NODE} (bundles npm ${REQUIRED_NPM}), or: npm install -g npm@${REQUIRED_NPM}`
	);
}

try {
	const { execFileSync } = await import('node:child_process');
	const legacyPeerDeps = execFileSync('npm', ['config', 'get', 'legacy-peer-deps'], {
		encoding: 'utf8',
		cwd: root
	}).trim();
	if (legacyPeerDeps === 'true') {
		errors.push(
			`legacy-peer-deps is true (must be false to match Azure). Check repo .npmrc and run npm config delete legacy-peer-deps if set in your user config.`
		);
	}
} catch {
	// ignore config probe failures
}

const lockPath = path.join(root, 'package-lock.json');
let lock;
try {
	lock = JSON.parse(readFileSync(lockPath, 'utf8'));
} catch (error) {
	errors.push(`Could not read package-lock.json: ${error instanceof Error ? error.message : String(error)}`);
}

if (lock?.packages) {
	for (const key of REQUIRED_LOCKFILE_PEERS) {
		if (!lock.packages[key]) {
			errors.push(
				`package-lock.json is missing ${key}. These peers are required for Azure \`npm ci\` (Prisma Studio / Radix). Re-run \`npm install\` with npm ${REQUIRED_NPM} after ensuring optionalDependencies include react/react-dom/scheduler, or restore from commit 2e4f99d.`
			);
		}
	}
}

try {
	const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
	const preactOverride = pkg.overrides?.preact;
	if (!preactOverride || !String(preactOverride).startsWith('^10.')) {
		errors.push(
			`package.json overrides.preact must be ^10.x (Defra interactive map). Without it Azure npm ci fails on accessible-autocomplete's preact@8 peer.`
		);
	}
} catch {
	// ignore
}

if (errors.length > 0) {
	console.error('\nToolchain check failed (align with Azure Pipelines):\n');
	for (const message of errors) {
		console.error(`  • ${message}`);
	}
	console.error('\nDocs: AGENTS.md → “Node and npm toolchain”. Bypass: SKIP_TOOLCHAIN_CHECK=1\n');
	process.exit(1);
}

console.log(`Toolchain OK: Node ${nodeVersion}, npm ${resolvedNpm}`);
