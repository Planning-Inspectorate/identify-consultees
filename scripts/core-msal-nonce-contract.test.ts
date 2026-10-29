import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, mock, test } from 'node:test';
import { pathToFileURL } from 'node:url';

// Guards the contract between @planning-inspectorate/core's auth-code exchange and the
// @azure/msal-node it resolves. Core's AuthService calls
// `msalClient.acquireTokenByCode(request, { code, nonce })` — the session nonce must
// still be present on the payload (or the request) when msal-node hands the exchange to
// its internals, or msal-common's strict nonce check throws nonceMismatch and every
// sign-in 500s at /auth/redirect. That is what broke dev/test when an override forced
// core's declared msal-node 6.x up to 7.x: v7's ConfidentialClientApplication rebuilds
// the payload as { code: request.code, state, nonce: request.nonce }, dropping the
// payload nonce core set (commits 3a530ae1 broke, 56d4f6c0 reverted). This drives the
// real pair of installed packages so it fails while they are incompatible.

const require = createRequire(import.meta.url);
// anchored inside core so @azure/msal-node resolves the same copy core loads, whether
// npm nests one under core or dedupes it to the root
const coreRequire = createRequire(require.resolve('@planning-inspectorate/core/auth'));

type MsalPackageJson = {
	name?: string;
	main?: string;
	module?: string;
	exports?: Record<string, unknown>;
};

// core imports the ESM build; require() only locates the package, then we read its
// import-condition entry so the patched prototype is the one core's import sees
function coreMsalNodeEsmEntry(): string {
	let dir = path.dirname(coreRequire.resolve('@azure/msal-node'));
	for (;;) {
		const pkgJsonPath = path.join(dir, 'package.json');
		if (fs.existsSync(pkgJsonPath)) {
			const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as MsalPackageJson;
			if (pkg.name === '@azure/msal-node') {
				const dotExport = pkg.exports?.['.'];
				const importCondition = typeof dotExport === 'object' && dotExport !== null ? dotExport['import'] : undefined;
				const esmEntry =
					(typeof importCondition === 'string'
						? importCondition
						: ((importCondition as { default?: string } | undefined)?.default ??
							(typeof dotExport === 'string' ? dotExport : undefined))) ??
					pkg.module ??
					pkg.main;
				if (!esmEntry) throw new Error('the resolved @azure/msal-node has no entry point');
				return pathToFileURL(path.join(dir, esmEntry)).href;
			}
		}
		const parent = path.dirname(dir);
		if (parent === dir) throw new Error('could not locate @azure/msal-node for @planning-inspectorate/core');
		dir = parent;
	}
}

type AcquireTokenByCode = (request: { nonce?: string }, authCodePayload?: { nonce?: string }) => unknown;

// the nonce can be rewritten by wrappers between core's call and msal-common, so patch
// the deepest own implementation in the chain — the one the internals actually invoke
function deepestAcquireTokenByCode(prototype: object): Record<'acquireTokenByCode', AcquireTokenByCode> {
	let owner: Record<'acquireTokenByCode', AcquireTokenByCode> | null = null;
	let current: object | null = prototype;
	while (current && current !== Object.prototype) {
		if (Object.hasOwn(current, 'acquireTokenByCode')) {
			owner = current as Record<'acquireTokenByCode', AcquireTokenByCode>;
		}
		current = Object.getPrototypeOf(current);
	}
	assert.ok(owner, 'acquireTokenByCode not found on the resolved ConfidentialClientApplication');
	return owner;
}

const { AuthService } = (await import('@planning-inspectorate/core/auth')) as {
	AuthService: new (options: {
		config: Record<string, unknown>;
		logger: Record<string, () => void>;
		redisClient: null;
	}) => { acquireTokenByCode(options: { code: string; sessionId: string; nonce: string }): Promise<unknown> };
};
const { ConfidentialClientApplication } = (await import(coreMsalNodeEsmEntry())) as {
	ConfidentialClientApplication: { prototype: object };
};

describe('@planning-inspectorate/core acquireTokenByCode nonce contract', () => {
	test('the session nonce reaches the msal-node internals that validate it', async () => {
		const sessionNonce = 'test-session-nonce';
		const owner = deepestAcquireTokenByCode(ConfidentialClientApplication.prototype);
		const intercept = mock.method(owner, 'acquireTokenByCode', () => Promise.resolve(null));
		try {
			const authService = new AuthService({
				config: {
					authority: 'https://login.microsoftonline.com/test-tenant-id',
					clientId: '00000000-0000-0000-0000-000000000000',
					clientSecret: 'test-client-secret',
					groups: { applicationAccess: 'test-group-id' },
					redirectUri: 'https://localhost:8080/auth/redirect',
					signoutUrl: 'https://localhost:8080/sign-out'
				},
				logger: { error() {}, warn() {}, info() {}, debug() {}, trace() {} },
				redisClient: null
			});
			await authService.acquireTokenByCode({ code: 'test-auth-code', sessionId: 'test-session', nonce: sessionNonce });
		} finally {
			intercept.mock.restore();
		}

		assert.equal(intercept.mock.callCount(), 1, 'AuthService.acquireTokenByCode did not reach msal-node');
		const [request, authCodePayload] = intercept.mock.calls[0].arguments as [
			{ nonce?: string },
			{ nonce?: string } | undefined
		];
		assert.equal(
			authCodePayload?.nonce ?? request?.nonce,
			sessionNonce,
			'the session nonce is dropped before msal-node hands the auth-code exchange to its ' +
				'internals — msal-common will throw nonceMismatch and sign-in will 500 at ' +
				'/auth/redirect (the dev/test outage from the core msal-node 7.x override)'
		);
	});
});
