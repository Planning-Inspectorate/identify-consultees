# msal-node 7 sign-in failure: dropped nonce at `acquireTokenByCode`

Why Entra sign-in failed on Dev, Test and Training after `@planning-inspectorate/core` 1.15.1
moved its auth onto `@azure/msal-node` 7.x, what the real fix is, and what to check before
upgrading core again.

## Symptom

Users reach the Microsoft sign-in, complete it, and are sent back to `/auth/redirect` — then land
on `/unauthenticated`. The app log shows a `ClientAuthError` with code `nonceMismatch` from the
token exchange. Every sign-in fails; nothing about the app registration, redirect URIs, groups or
secrets is wrong.

## Root cause

Three pieces of upstream behaviour line up badly against how `@planning-inspectorate/core`
(≤ 1.15.x) calls MSAL:

1. **Core carries the nonce on the auth code payload, not the request.** `AuthService` sends the
   OIDC nonce in `getAuthCodeUrl({ nonce })` — so the returned ID token always contains a `nonce`
   claim — then calls
   `acquireTokenByCode({ authority, code, redirectUri, scopes }, { code, nonce })`, i.e. the
   expected nonce lives only in the second-argument `AuthorizationCodePayload`.

2. **msal-node ≥ 7.0.2 sanitizes that payload away** (AzureAD/microsoft-authentication-library-for-js
   PR [#8901](https://github.com/AzureAD/microsoft-authentication-library-for-js/pull/8901),
   "sanitize authorization code payloads", shipped in 7.0.2 and 7.1.0).
   `ConfidentialClientApplication.acquireTokenByCode` rebuilds the payload as
   `{ code: request.code, state: payload.state, nonce: request.nonce }` — it reads `nonce` off the
   **request** object and silently drops `payload.nonce`, the only place core puts it.

3. **msal-common's strict nonce check then rejects the token.** In `ResponseHandler`, a payload
   carrying a `nonce` key at all opts into strict validation: the ID token has a `nonce` claim but
   the expected nonce is `undefined`, so it throws `nonceMismatch`. msal-node's base
   `ClientApplication` always writes the `nonce` key onto the payload it forwards
   (`nonce: expectedNonce`), so strict mode is on even though the expected value was lost.

The net effect: the documented-in-msal-node-6 pattern of passing the nonce on the payload becomes a
guaranteed failure in 7.0.2+ for every confidential-client consumer, with no error pointing at the
real cause. In msal-node 7 the supported place for the expected nonce is
`AuthorizationCodeRequest.nonce` — the first argument. Verified still broken in `@azure/msal-node`
7.2.1 (the latest at time of writing).

### Which versions are affected

| Combination                                           | Result                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| core ≤ 1.15.0 (its own msal-node 6.x, e.g. 6.0.1)     | Works — `payload.nonce` reaches the check via the fallback           |
| core 1.15.1+ (msal-node `7.x`, resolving ≥ 7.0.2)     | **Broken** — sanitizer drops `payload.nonce` → `nonceMismatch`       |
| msal-node 7.0.0/7.0.1                                 | Works — no sanitizer, payload passed through                         |
| `@azure/identity` / `@redis/entraid` on msal-node 7.x | Unaffected — client-credential/managed-identity flows carry no nonce |

Note the repo pins `@azure/msal-node ^7.1.1` at root for `@azure/identity` and `@redis/entraid`
(non-interactive flows). Those are fine on 7.x — only the auth-code user sign-in path is affected,
and that path belongs to core.

## The fix

**We are not blocked on Microsoft.** The caller is `@planning-inspectorate/core`, which PINS owns.
The fix is one line in its `src/auth/auth-service.ts` — pass `nonce` on the token request:

```ts
return await msalClient.acquireTokenByCode(
	{
		authority: this.#config.authority,
		code,
		nonce, // msal-node ≥ 7.0.2 reads the expected nonce from the request, not the payload
		redirectUri: this.#config.redirectUri,
		scopes: this.#scopes
	},
	authCodePayload // keep passing it too - on msal-node ≤ 6 only payload.nonce is honoured
);
```

`AuthorizationCodeRequest.nonce` already exists on msal-node 5.6+/6.x (the base class prefers
`request.nonce` and falls back to `payload.nonce`), so passing it in both places works on every
supported version — no version-conditional code needed. Once a core release containing this ships,
upgrade `@planning-inspectorate/core` here and sign-in works on msal-node 7.

Worth also reporting upstream (AzureAD/microsoft-authentication-library-for-js): the 7.0.2
sanitizer makes the base class's `payload.nonce` fallback unreachable for confidential clients,
which looks like an unannounced breaking change — a `request.nonce ?? payload.nonce` fallback in
`ConfidentialClientApplication.acquireTokenByCode` would restore the old contract. Helpful to the
ecosystem, but not required for our fix.

## What didn't work, and why

A `deps:patch-core-msal-nonce` postinstall script was tried (rewriting core's installed
`dist/auth/auth-service.js` to add `nonce` to the request, matching the `deps:patch-maplibre` /
`deps:patch-im-aria-controls` pattern). It fixed local checkouts and CI but **never reached the
deployed image**: `apps/manage/Dockerfile` runs `npm ci --ignore-scripts` — the root postinstall
does not run in the image build — and then invokes each patch script it needs by name
(`RUN npm run deps:patch-maplibre && npm run deps:patch-im-aria-controls`). The nonce patch wasn't
on that list, so the container shipped the unpatched file. Worse, the patch masks the bug locally:
with it in place, a broken core upgrade can pass every local and CI check and still fail in
production. It has been removed.

Two lessons:

- Postinstall `node_modules` patches are dev/CI-only unless the Dockerfile's explicit `RUN` line
  invokes them — and a patch that fixes auth silently in dev but not in the image is a trap, not a
  safety net.
- For a library PINS owns, fix the source package rather than patching its build output.

## Checklist for the next core upgrade

- [ ] The core release's `AuthService.acquireTokenByCode` passes `nonce` on the request object
      (check `dist/auth/auth-service.js` — `acquireTokenByCode({ authority, code, nonce, ... })`).
- [ ] No leftover `deps:patch-core-msal-nonce` script or postinstall entry (removed in the
      documentation PR that recorded this issue).
- [ ] After deploying to Dev, complete a real Entra sign-in before promoting — this class of
      failure is invisible to every automated check we currently run (`AUTH_DISABLED` locally, no
      live Entra in CI).
