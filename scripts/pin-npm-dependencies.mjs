#!/usr/bin/env node
/**
 * Pin all dependency version ranges in package.json files to the exact
 * versions currently resolved in package-lock.json.
 *
 * Usage: node scripts/pin-npm-dependencies.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

const packageJsonPaths = [
	'package.json',
	'apps/manage/package.json',
	'apps/function/package.json',
	'packages/database/package.json',
	'packages/lib/package.json'
].map((relativePath) => path.join(ROOT, relativePath));

/**
 * @param {string} name
 * @param {string} requested
 * @returns {string | null}
 */
function exactFromLockfile(name, requested) {
	const entry = lock.packages[`node_modules/${name}`];

	if (typeof requested === 'string' && requested.startsWith('npm:')) {
		const match = requested.match(/^npm:(?<target>@?[^@]+)@(?<range>.+)$/);
		if (!match?.groups) {
			return null;
		}

		if (entry?.version) {
			const targetName = entry.name || match.groups.target;
			return `npm:${targetName}@${entry.version}`;
		}

		return null;
	}

	if (entry?.version) {
		return entry.version;
	}

	// Workspace packages are not under node_modules/<name> as a registry package
	if (requested === '*' || requested.startsWith('^') || requested.startsWith('~')) {
		const workspace = Object.values(lock.packages).find(
			(pkg) => pkg.name === name && pkg.version && !pkg.resolved
		);
		if (workspace?.version) {
			return workspace.version;
		}
	}

	return null;
}

/**
 * @param {string} version
 */
function isRange(version) {
	if (version === '*' || version === '' || version === 'latest') {
		return true;
	}

	if (version.startsWith('npm:')) {
		return /@[^@]*[\^~><=*xX ]/.test(version) || /@\*$/.test(version);
	}

	return /^[\^~><=]|(\.x\b)|\|\|/.test(version);
}

let changedFiles = 0;

for (const packageJsonPath of packageJsonPaths) {
	if (!fs.existsSync(packageJsonPath)) {
		continue;
	}

	const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
	let changed = false;

	for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
		const deps = pkg[section];
		if (!deps) {
			continue;
		}

		for (const [name, requested] of Object.entries(deps)) {
			if (!isRange(String(requested)) && !String(requested).includes('^') && !String(requested).includes('~')) {
				// Still normalise aliases that embed ranges
				if (!String(requested).startsWith('npm:') || !isRange(String(requested))) {
					continue;
				}
			}

			const exact = exactFromLockfile(name, String(requested));
			if (!exact) {
				console.warn(`Could not resolve exact version for ${name} (${requested}) in ${path.relative(ROOT, packageJsonPath)}`);
				continue;
			}

			if (deps[name] !== exact) {
				deps[name] = exact;
				changed = true;
			}
		}
	}

	if (changed) {
		fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
		changedFiles += 1;
		console.log(`Pinned dependencies in ${path.relative(ROOT, packageJsonPath)}`);
	}
}

if (changedFiles === 0) {
	console.log('All package.json dependency versions already pinned.');
} else {
	console.log(`Updated ${changedFiles} package.json file(s). Run npm install to refresh the lockfile if needed.`);
}
