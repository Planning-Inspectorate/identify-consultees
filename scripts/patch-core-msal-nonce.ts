/**
 * Patch `@planning-inspectorate/core`'s auth-code exchange so the session nonce is
 * passed on the `acquireTokenByCode` request, not only inside `authCodePayload`.
 *
 * Core 1.15.0 passes `{ code, nonce }` as the second `authCodePayload` argument — the
 * msal-node 6 contract. The `overrides` entry forces its `@azure/msal-node` onto the
 * patched 7.x line (GHSA-xcx6-jx8p-x3h5), whose `ConfidentialClientApplication`
 * rebuilds the payload as `{ code: request.code, state, nonce: request.nonce }` — so
 * the payload nonce arrives as `undefined` and msal-common's strict check throws
 * `nonceMismatch`, failing every sign-in at `/auth/redirect`.
 *
 * Putting `nonce` on the request satisfies both contracts: v7's sanitizer picks it up,
 * and v6 still honours the payload it is passed. Remove this patch once a core release
 * moves the nonce onto the request upstream. `scripts/core-msal-nonce-contract.test.ts`
 * verifies the nonce actually reaches msal-node's internals.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Core's request object as shipped (nonce only inside `authCodePayload`). */
export const UNPATCHED_ACQUIRE_TOKEN_BY_CODE = '            scopes: this.#scopes\n        }, authCodePayload);';

/** Same request with `nonce` on it, which msal-node 7's payload sanitizer picks up. */
export const PATCHED_ACQUIRE_TOKEN_BY_CODE =
	'            scopes: this.#scopes,\n            nonce\n        }, authCodePayload);';

/**
 * Apply the nonce fix to an `auth-service.js` source string.
 *
 * @param source - `auth-service.js` contents
 * @returns Patched source and whether a change was made
 */
export function applyCoreMsalNoncePatch(source: string): {
	source: string;
	changed: boolean;
	alreadyPatched: boolean;
} {
	if (source.includes(PATCHED_ACQUIRE_TOKEN_BY_CODE)) {
		return { source, changed: false, alreadyPatched: true };
	}
	if (!source.includes(UNPATCHED_ACQUIRE_TOKEN_BY_CODE)) {
		throw new Error(
			'core msal-node nonce patch: expected unpatched acquireTokenByCode pattern was not found (@planning-inspectorate/core may have changed - check whether the fix landed upstream).'
		);
	}
	return {
		source: source.replace(UNPATCHED_ACQUIRE_TOKEN_BY_CODE, PATCHED_ACQUIRE_TOKEN_BY_CODE),
		changed: true,
		alreadyPatched: false
	};
}

/**
 * Absolute path to core's `auth-service.js` wherever this install resolves it.
 *
 * @param packageRoot - Repo root (defaults to this package)
 * @returns Absolute path to `dist/auth/auth-service.js`
 */
export function coreAuthServicePath(packageRoot = process.cwd()): string {
	const require = createRequire(path.join(packageRoot, 'package.json'));
	const coreEntry = require.resolve('@planning-inspectorate/core');
	return path.join(path.dirname(coreEntry), 'auth', 'auth-service.js');
}

/**
 * Patch the on-disk `auth-service.js` if needed.
 *
 * @param filePath - Path to `auth-service.js`
 * @param options - Optional behaviour flags
 * @param options.log - When `true`, print patch status to stdout (CLI use)
 * @returns Whether the file was rewritten
 */
export function patchCoreAuthServiceFile(filePath: string, options: { log?: boolean } = {}): boolean {
	const log = options.log === true;
	const original = fs.readFileSync(filePath, 'utf8');
	// applyCoreMsalNoncePatch only returns changed: false alongside alreadyPatched: true (it
	// throws otherwise), so reaching the write means the file was rewritten
	const { source, alreadyPatched } = applyCoreMsalNoncePatch(original);
	if (alreadyPatched) {
		if (log) {
			console.log(`core msal-node nonce already patched: ${filePath}`);
		}
		return false;
	}
	fs.writeFileSync(filePath, source);
	if (log) {
		console.log(`Patched core acquireTokenByCode nonce (GHSA-xcx6-jx8p-x3h5 override compatibility): ${filePath}`);
	}
	return true;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
	let target: string;
	try {
		target = coreAuthServicePath();
	} catch {
		// this postinstall hook runs for every npm ci, including workspace-scoped ones
		// (e.g. `npm ci --workspace=@pins/identify-consultees-database` in the Migrate
		// deploy job) that never install apps/manage's own dependencies - nothing to patch
		console.log('core msal-node nonce patch: @planning-inspectorate/core not installed here, skipping.');
		process.exit(0);
	}
	patchCoreAuthServiceFile(target, { log: true });
}
