#!/usr/bin/env node
/**
 * Guardrail so local installs stay aligned with Azure Pipelines `npm ci`.
 *
 * CI (`.azure/pipelines/*` via PINS `node_script.yml`) runs `nodeVersion: 24`,
 * which tracks the latest Node 24.x and its bundled npm 11.x. The repo pins the
 * *major* only - `engines` in package.json (`node: ^24`, `npm: >=11`) is the
 * single source of truth, and this script checks the running toolchain against
 * those ranges. Regenerating the lockfile under a different Node/npm major can
 * drop Prisma Studio peer entries (`react` / `react-dom` / `scheduler`) and
 * break `npm ci` — see PR #53 / commit 2e4f99d.
 *
 * Set SKIP_TOOLCHAIN_CHECK=1 to bypass (emergencies only).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

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

function compareVersions(a, b) {
	for (let i = 0; i < 3; i += 1) {
		if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
	}
	return 0;
}

/**
 * Minimal semver-range check for the simple specifiers we use in engines:
 *   ^24 / ^24.15.0   → same major, >= the given version
 *   >=11 / >=11.2.0  → >= the given version
 *   24 / 24.x        → same major (partial version, no operator)
 *   24.15.0          → exact
 * Anything more complex fails closed so a malformed range is caught rather
 * than silently passing.
 */
function satisfies(version, range) {
	const match = String(range)
		.trim()
		.match(/^(\^|>=)?\s*v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/);
	if (!match) return false;
	const [, operator, major, minor, patch] = match;
	const parts = versionParts(version);
	const required = [Number(major)];
	if (minor !== undefined && minor !== 'x' && minor !== '*') required.push(Number(minor));
	if (patch !== undefined && patch !== 'x' && patch !== '*') required.push(Number(patch));
	const cmp = compareVersions(parts, required);
	if (operator === '^') return parts[0] === required[0] && cmp >= 0;
	if (operator === '>=') return cmp >= 0;
	if (required.length === 1) return parts[0] === required[0];
	if (required.length === 2) return parts[0] === required[0] && parts[1] === required[1];
	return cmp === 0;
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const engines = pkg.engines || {};

const nodeVersion = process.versions.node;
if (!satisfies(nodeVersion, engines.node || '')) {
	errors.push(
		`Node ${nodeVersion} does not satisfy engines.node "${engines.node}" (see .nvmrc / Azure Pipelines nodeVersion). Run: nvm install && nvm use`
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

if (!resolvedNpm || !satisfies(resolvedNpm, engines.npm || '')) {
	errors.push(
		`npm ${resolvedNpm || '(unknown)'} does not satisfy engines.npm "${engines.npm}". npm ships with Node ${engines.node} - run: nvm install && nvm use`
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
				`package-lock.json is missing ${key}. These peers are required for Azure \`npm ci\` (Prisma Studio / Radix). Re-run \`npm install\` under Node ${engines.node} after ensuring optionalDependencies include react/react-dom/scheduler, or restore from commit 2e4f99d.`
			);
		}
	}
}

const preactOverride = pkg.overrides?.preact;
if (!preactOverride || !String(preactOverride).startsWith('^10.')) {
	errors.push(
		`package.json overrides.preact must be ^10.x (Defra interactive map). Without it Azure npm ci fails on accessible-autocomplete's preact@8 peer.`
	);
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
