# src/lib — vendored PINS core

These modules are a TypeScript port of `@planning-inspectorate/core` 1.15.0, vendored in because the
package is no longer maintained. They keep the package's module layout (`app`, `auth`, `controllers`,
`middleware`, `redis`, `testing`, `util`, `ui`) and behaviour so the app works exactly as before —
`ui/` is copied verbatim so the header and footer render pixel-for-pixel the same.

Only what the app uses is ported; unused exports (`TestServer`, `custom-asserts`, `retry`, the
session-data helpers, `pins-footer.njk` — already replicated as `appFooter` in `layouts/main.njk`)
were left out.

Intentional changes from the vendored code:

- `auth/auth-service.ts` passes the session `nonce` on the `acquireTokenByCode` request, not via
  `authCodePayload` — the msal-node 7 contract (see the comment in that file).
- `util/session.ts` keeps `initSessionMiddleware` only.

`src/lib/**` is excluded from the unit-test coverage gate for the same reason `node_modules` code is:
it's ported library code, not app source.
