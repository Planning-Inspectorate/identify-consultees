/**
 * Guardrail so local installs stay aligned with Azure Pipelines `npm ci`.
 *
 * CI (`.azure/pipelines/*` via PINS `node_script.yml`) runs `nodeVersion: 24`;
 * the npm ci steps first source scripts/ci-use-latest-node.sh so the agent gets
 * the latest Node 24.x and its bundled npm 11.x rather than an older
 * preinstalled one. The repo pins the
 * *major* only - `engines` in package.json (`node: ^24.22.1`, `npm: >=11`) is the
 * single source of truth, and this script checks the running toolchain against
 * those ranges. Regenerating the lockfile under a different Node/npm major can
 * drop Prisma Studio peer entries (`react` / `react-dom` / `scheduler`) and
 * break `npm ci` — see PR #53 / commit 2e4f99d.
 *
 * Set SKIP_TOOLCHAIN_CHECK=1 to bypass (emergencies only).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Lockfile package keys that must remain present for `npm ci` (Prisma Studio / Radix peers). */
const REQUIRED_LOCKFILE_PEERS = ['node_modules/react', 'node_modules/react-dom', 'node_modules/scheduler'];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function versionParts(version: string): number[] {
	return String(version)
		.replace(/^v/, '')
		.split('.')
		.map((part) => Number.parseInt(part, 10));
}

export function compareVersions(a: number[], b: number[]): number {
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
export function satisfies(version: string, range: string): boolean {
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

export interface ToolchainCheckOptions {
	/** Directory containing package.json and package-lock.json (the repo root by default). */
	root?: string;
	/** Environment to read SKIP/npm version hints from (process.env by default). */
	env?: NodeJS.ProcessEnv;
	/** Node version to validate (the running process's by default). */
	nodeVersion?: string;
	/** Command runner for the npm probes - injectable so tests can control npm's answers. */
	execFile?: typeof execFileSync;
}

/** A thrown value's message, whether or not it was an Error. */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * npm's version, preferring what the package manager told the script before
 * asking npm itself - `npm run check-toolchain` exports npm_config_user_agent,
 * a bare `node scripts/check-toolchain.ts` does not. Returns undefined when
 * npm cannot be asked either.
 */
export function npmVersion(env: NodeJS.ProcessEnv, execFile: typeof execFileSync): string | undefined {
	const fromEnv = env.npm_config_user_agent?.match(/npm\/(\d+\.\d+\.\d+)/)?.[1] || env.npm_version;
	if (fromEnv) {
		return fromEnv;
	}
	try {
		return execFile('npm', ['-v'], { encoding: 'utf8' }).trim();
	} catch {
		return undefined;
	}
}

/**
 * Every toolchain problem found, or an empty list when the toolchain matches
 * what Azure's `npm ci` expects. All inputs are injectable for tests.
 */
export function collectToolchainErrors(options: ToolchainCheckOptions = {}): string[] {
	const checkRoot = options.root ?? root;
	const env = options.env ?? process.env;
	const nodeVersion = options.nodeVersion ?? process.versions.node;
	const execFile = options.execFile ?? execFileSync;

	const errors: string[] = [];

	const pkg = JSON.parse(readFileSync(path.join(checkRoot, 'package.json'), 'utf8'));
	const engines = pkg.engines || {};

	if (!satisfies(nodeVersion, engines.node || '')) {
		errors.push(
			`Node ${nodeVersion} does not satisfy engines.node "${engines.node}" (see .nvmrc / Azure Pipelines nodeVersion). Run: nvm install && nvm use`
		);
	}

	const resolvedNpm = npmVersion(env, execFile);
	if (!resolvedNpm || !satisfies(resolvedNpm, engines.npm || '')) {
		errors.push(
			`npm ${resolvedNpm || '(unknown)'} does not satisfy engines.npm "${engines.npm}". npm ships with Node ${engines.node} - run: nvm install && nvm use`
		);
	}

	try {
		const legacyPeerDeps = execFile('npm', ['config', 'get', 'legacy-peer-deps'], {
			encoding: 'utf8',
			cwd: checkRoot
		}).trim();
		if (legacyPeerDeps === 'true') {
			errors.push(
				`legacy-peer-deps is true (must be false to match Azure). Check repo .npmrc and run npm config delete legacy-peer-deps if set in your user config.`
			);
		}
	} catch {
		// ignore config probe failures
	}

	let lock;
	try {
		lock = JSON.parse(readFileSync(path.join(checkRoot, 'package-lock.json'), 'utf8'));
	} catch (error) {
		errors.push(`Could not read package-lock.json: ${errorMessage(error)}`);
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

	return errors;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
	if (process.env.SKIP_TOOLCHAIN_CHECK === '1') {
		process.exit(0);
	}

	const errors = collectToolchainErrors();
	if (errors.length > 0) {
		console.error('\nToolchain check failed (align with Azure Pipelines):\n');
		for (const message of errors) {
			console.error(`  • ${message}`);
		}
		console.error('\nDocs: AGENTS.md → “Node and npm toolchain”. Bypass: SKIP_TOOLCHAIN_CHECK=1\n');
		process.exit(1);
	}

	console.log(`Toolchain OK: Node ${process.versions.node}, npm ${npmVersion(process.env, execFileSync)}`);
}
