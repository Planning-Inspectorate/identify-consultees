# Vendored dependencies

## `sprintf-js` — vendored 1.1.3 + CVE-2026-97058 patch

`sprintf-js` reaches this project transitively via `@prisma/adapter-mssql` → `mssql` → `tedious`.
Versions ≤ 1.1.3 are vulnerable to denial of service via unbounded precision specifiers
([GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)): an attacker who controls
a format string can pass `%.101f` and crash the process with an uncaught `RangeError`, because the
parsed precision is handed straight to `toFixed`/`toExponential`/`toPrecision`.

Upstream has no fix (see [sprintf.js#237](https://github.com/alexei/sprintf.js/issues/237)) and no
published patched alternative is API-compatible, so `vendor/sprintf-js/` carries the upstream 1.1.3
`src/sprintf.js` (the file `package.json`'s `main` points to) with one change: the parsed precision
is clamped to 100 — the ECMAScript limit for `toFixed`/`toExponential`/`toPrecision` — instead of
throwing. The version is bumped to `1.1.4` so the lockfile records a version outside the advisory's
affected range.

The root `package.json` pins it over the transitive dependency:

```json
"overrides": { "sprintf-js": "file:vendor/sprintf-js" }
```

### Re-verifying / removing

- Confirm the override is in use: `npm ls sprintf-js` should show `sprintf-js@1.1.4 -> ./vendor/sprintf-js`.
- If upstream publishes a fixed release, remove the override, delete `vendor/sprintf-js/`, and run
  `npm install` to let the registry version resolve.
