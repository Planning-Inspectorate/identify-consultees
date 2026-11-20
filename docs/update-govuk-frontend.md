# Updating GOV.UK Frontend

`govuk-frontend` supplies the service's styles, component JS and assets. Two places pin it:

- `dependencies.govuk-frontend` in the root `package.json` — the copy everything uses.
- `overrides."@defra/interactive-map".govuk-frontend` — forces the vendored Defra map bundle onto the same copy, so the app doesn't ship two versions of the design system. Keep this on the same range; the script below does it for you.

## The one-command update

```bash
npm run deps:update-govuk-frontend
```

Run from the repo root. It:

1. prints the installed version against the latest on npm;
2. `npm install govuk-frontend@^<latest>` — updates `dependencies` and `package-lock.json`;
3. syncs the `@defra/interactive-map` override to the same range and re-installs if it moved;
4. runs the `apps/manage` build — the fingerprinted stylesheet/asset names and `src/util/config-middleware.ts` regenerate against the new version.

Use the repo's pinned toolchain (see `AGENTS.md` → "Node and npm toolchain") — `npm run check-toolchain` verifies yours matches.

## Then review and ship it

1. **Skim the [release notes](https://github.com/alphagov/govuk-frontend/releases)** — GOV.UK Frontend breaking changes are flagged per version; a major bump needs eyes on markup/class renames, not just this script.
2. **Smoke-test a page locally** — the script only swaps code; look at a page for visual regressions (header, buttons, table headers).
3. **Run `npm run test-coverage`** — the full CI gate.
4. **Commit the result on a `chore/` branch and open a PR** — `package.json`, `package-lock.json` and `apps/manage/src/util/config-middleware.ts` change; `.static` output is gitignored and rebuilt on deploy.

## If the override sync reports it found nothing

The script expects the override to sit in `overrides."@defra/interactive-map"` — if the dependency graph changes (e.g. the vendor bundle is updated or un-pinned), edit `overrides` by hand or drop the stale entry after confirming nothing installs `govuk-frontend` transitively (`npm ls govuk-frontend` shows who resolves what).
