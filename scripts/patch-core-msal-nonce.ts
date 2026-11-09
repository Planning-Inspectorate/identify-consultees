/**
 * Patch `@planning-inspectorate/core`'s `AuthService.acquireTokenByCode` so the
 * OIDC nonce travels on the `acquireTokenByCode` request object, where msal-node
 * 7 looks for it, instead of only on the second-argument auth code payload.
 *
 * `@azure/msal-node` >= 7.0.2 (microsoft-authentication-library-for-js#8901,
 * "sanitize authorization code payloads") rebuilds the payload inside
 * `ConfidentialClientApplication.acquireTokenByCode` as
 * `{ code: request.code, state: payload.state, nonce: request.nonce }` - it
 * silently drops `authCodePayload.nonce`, the only place core 1.15.x puts the
 * nonce. msal-common's strict nonce check then sees an ID token `nonce` claim
 * (the authorize URL still sends one) with no expected nonce and throws
 * `nonceMismatch`, so every Entra sign-in fails at `/auth/redirect`. Still
 * unfixed in msal-node 7.2.1; remove this patch once
 * `@planning-inspectorate/core` passes `nonce` on the request itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `acquireTokenByCode` request literal from `@planning-inspectorate/core` <= 1.15.1 (no `nonce`). */
export const VULNERABLE_TOKEN_REQUEST = `acquireTokenByCode({
            authority: this.#config.authority,
            code,
            redirectUri: this.#config.redirectUri,
            scopes: this.#scopes
        }, authCodePayload)`;

/** Same literal with `nonce` on the request, where msal-node 7's sanitizer reads it. */
export const PATCHED_TOKEN_REQUEST = `acquireTokenByCode({
            authority: this.#config.authority,
            code,
            nonce,
            redirectUri: this.#config.redirectUri,
            scopes: this.#scopes
        }, authCodePayload)`;

/**
 * Apply the nonce fix to a JS source string.
 *
 * @param source - Bundle or fixture source
 * @returns Patched source and whether a change was made
 */
export function applyCoreMsalNoncePatch(source: string): {
	source: string;
	changed: boolean;
	alreadyPatched: boolean;
} {
	if (source.includes(PATCHED_TOKEN_REQUEST)) {
		return { source, changed: false, alreadyPatched: true };
	}
	if (!source.includes(VULNERABLE_TOKEN_REQUEST)) {
		throw new Error(
			'Core MSAL nonce patch: expected acquireTokenByCode request without nonce was not found (@planning-inspectorate/core may have changed or fixed this upstream - review whether this patch is still needed).'
		);
	}
	return {
		source: source.replace(VULNERABLE_TOKEN_REQUEST, PATCHED_TOKEN_REQUEST),
		changed: true,
		alreadyPatched: false
	};
}

/**
 * Absolute path to the core auth service bundle inside node_modules.
 *
 * @param packageRoot - Repo root (defaults to this package)
 * @returns Absolute path to `auth-service.js`
 */
export function coreAuthServicePath(packageRoot = process.cwd()): string {
	return path.join(packageRoot, 'node_modules', '@planning-inspectorate', 'core', 'dist', 'auth', 'auth-service.js');
}

/**
 * Patch the on-disk core auth service bundle if needed.
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
	// throws otherwise), so reaching the write means the bundle was rewritten
	const { source, alreadyPatched } = applyCoreMsalNoncePatch(original);
	if (alreadyPatched) {
		if (log) {
			console.log(`Core MSAL nonce patch already applied: ${filePath}`);
		}
		return false;
	}
	fs.writeFileSync(filePath, source);
	if (log) {
		console.log(`Patched acquireTokenByCode to send nonce on the request: ${filePath}`);
	}
	return true;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
	const target = coreAuthServicePath();
	if (!fs.existsSync(target)) {
		// this postinstall hook runs for every npm ci, including workspace-scoped ones
		// (e.g. `npm ci --workspace=@pins/identify-consultees-database` in the Migrate
		// deploy job) that never install apps/manage's own dependencies - nothing to patch
		console.log(`Core MSAL nonce patch: ${target} not installed here, skipping.`);
		process.exit(0);
	}
	patchCoreAuthServiceFile(target, { log: true });
}
