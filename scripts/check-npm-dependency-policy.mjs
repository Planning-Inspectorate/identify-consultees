#!/usr/bin/env node
/**
 * Enforce npm dependency policy:
 * - Exact versions only in package.json (no ^, ~, *, ranges)
 * - package-lock.json entries must include sha512 integrity hashes
 * - Resolved package versions must be at least COOLDOWN_DAYS old on the registry
 *
 * Usage:
 *   node scripts/check-npm-dependency-policy.mjs
 *   npm run check-npm-dependency-policy
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const COOLDOWN_DAYS = Number(process.env.NPM_COOLDOWN_DAYS || 7);
const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
const REGISTRY_CONCURRENCY = Number(process.env.NPM_COOLDOWN_CONCURRENCY || 25);

const packageJsonPaths = [
	'package.json',
	'apps/manage/package.json',
	'apps/function/package.json',
	'packages/database/package.json',
	'packages/lib/package.json'
].map((relativePath) => path.join(ROOT, relativePath));

/** @type {string[]} */
const errors = [];

/**
 * @param {string} version
 */
function hasDisallowedRange(version) {
	const value = String(version).trim();

	if (value === '*' || value === '' || value === 'latest') {
		return true;
	}

	// npm aliases: npm:name@version — version part must be exact
	if (value.startsWith('npm:')) {
		const at = value.lastIndexOf('@');
		// npm:@scope/pkg@1.2.3 or npm:pkg@1.2.3
		const versionPart = value.slice(at + 1);
		return hasDisallowedRange(versionPart);
	}

	// workspace: / file: / link: / http(s): leave to other tooling; flag ranges only
	if (/^(workspace:|file:|link:|git\+|https?:)/.test(value)) {
		return /[\^~*>< ]|\|\|/.test(value);
	}

	return /[\^~*><]|(\.x\b)|\|\|/.test(value);
}

/**
 * @param {string} packageJsonPath
 */
function checkPackageJsonPins(packageJsonPath) {
	const relativePath = path.relative(ROOT, packageJsonPath);
	const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

	for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
		const deps = pkg[section];
		if (!deps) {
			continue;
		}

		for (const [name, version] of Object.entries(deps)) {
			if (hasDisallowedRange(String(version))) {
				errors.push(`${relativePath}: ${section}["${name}"] must be an exact version (found "${version}")`);
			}
		}
	}
}

/**
 * @param {object} lock
 */
function checkLockfileIntegrity(lock) {
	for (const [pkgPath, meta] of Object.entries(lock.packages || {})) {
		if (!pkgPath || meta.link) {
			continue;
		}

		// Workspace / root packages have no resolved tarball
		if (!meta.resolved) {
			continue;
		}

		if (!meta.integrity) {
			errors.push(`package-lock.json: missing integrity for "${pkgPath}"`);
			continue;
		}

		if (!String(meta.integrity).startsWith('sha512-')) {
			errors.push(
				`package-lock.json: integrity for "${pkgPath}" must be sha512 (found "${String(meta.integrity).split('-')[0]}")`
			);
		}
	}
}

/**
 * @param {string} name
 */
function registryUrl(name) {
	const encoded = name.startsWith('@') ? `${name.replace('/', '%2F')}` : name;
	return `https://registry.npmjs.org/${encoded}`;
}

/**
 * Resolve the registry package name for a lockfile entry (handles npm aliases).
 * @param {string} lockPath
 * @param {{ name?: string, resolved?: string }} meta
 * @returns {string | null}
 */
function registryPackageName(lockPath, meta) {
	if (meta.name) {
		return meta.name;
	}

	if (meta.resolved) {
		try {
			const { pathname } = new URL(meta.resolved);
			// /@scope/name/-/name-1.2.3.tgz or /name/-/name-1.2.3.tgz
			const match = pathname.match(/^\/((?:@[^/]+\/)?[^/]+)\/-\//);
			if (match) {
				return decodeURIComponent(match[1]);
			}
		} catch {
			// fall through
		}
	}

	const parts = lockPath.replace(/^node_modules\//, '').split('/node_modules/');
	return parts[parts.length - 1] || null;
}

/**
 * @param {object} lock
 */
async function checkCooldown(lock) {
	/** @type {Map<string, { name: string, version: string }>} */
	const unique = new Map();

	for (const [pkgPath, meta] of Object.entries(lock.packages || {})) {
		if (!pkgPath.startsWith('node_modules/') || !meta.resolved || !meta.version || meta.link) {
			continue;
		}

		const name = registryPackageName(pkgPath, meta);
		if (!name) {
			continue;
		}

		unique.set(`${name}@${meta.version}`, { name, version: meta.version });
	}

	const list = [...unique.values()];
	const now = Date.now();
	let index = 0;

	async function worker() {
		while (index < list.length) {
			const current = list[index++];
			const { name, version } = current;

			try {
				const response = await fetch(registryUrl(name), {
					headers: { accept: 'application/json' }
				});

				if (!response.ok) {
					errors.push(`cooldown: failed to fetch metadata for ${name}@${version} (HTTP ${response.status})`);
					continue;
				}

				const data = await response.json();
				const published = data.time?.[version];

				if (!published) {
					errors.push(`cooldown: no publish time for ${name}@${version}`);
					continue;
				}

				const ageMs = now - Date.parse(published);
				if (Number.isNaN(ageMs)) {
					errors.push(`cooldown: invalid publish time for ${name}@${version}: ${published}`);
					continue;
				}

				if (ageMs < COOLDOWN_MS) {
					const ageDays = (ageMs / (24 * 60 * 60 * 1000)).toFixed(1);
					errors.push(
						`cooldown: ${name}@${version} was published ${ageDays} day(s) ago (requires ${COOLDOWN_DAYS}+ days). Published: ${published}`
					);
				}
			} catch (error) {
				errors.push(
					`cooldown: error checking ${name}@${version}: ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}
	}

	await Promise.all(Array.from({ length: REGISTRY_CONCURRENCY }, () => worker()));
}

function main() {
	for (const packageJsonPath of packageJsonPaths) {
		if (fs.existsSync(packageJsonPath)) {
			checkPackageJsonPins(packageJsonPath);
		}
	}

	const lockPath = path.join(ROOT, 'package-lock.json');
	if (!fs.existsSync(lockPath)) {
		errors.push('package-lock.json is missing');
		printAndExit();
		return;
	}

	const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
	checkLockfileIntegrity(lock);

	return checkCooldown(lock).then(printAndExit);
}

function printAndExit() {
	if (errors.length > 0) {
		console.error(`npm dependency policy check failed (${errors.length} issue(s)):\n`);
		for (const error of errors) {
			console.error(`- ${error}`);
		}
		console.error(
			`\nFix pins with: npm run pin-npm-dependencies\n` +
				`Ensure installs use npm ci (lockfile integrity) and wait ${COOLDOWN_DAYS} days before adopting new releases.`
		);
		process.exit(1);
	}

	console.log(
		`npm dependency policy check passed (exact pins, sha512 integrity, ${COOLDOWN_DAYS}-day cooldown).`
	);
}

await main();
