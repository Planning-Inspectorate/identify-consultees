# Testing

**Status:** Current — see also [`docs/frontend-testing.md`](../docs/frontend-testing.md).

## Layers

| Layer                 | How                                 | What it proves                                       |
| --------------------- | ----------------------------------- | ---------------------------------------------------- |
| Unit / integration    | `node --test` in manage + packages  | Controllers, helpers, HTTP wiring (`supertest`)      |
| GOV.UK fixtures       | `govuk-frontend-components.test.ts` | Macro HTML still matches Frontend fixtures           |
| A11y smoke            | `pages.a11y.test.ts` (axe + jsdom)  | Rendered Nunjucks pages                              |
| Playwright e2e / a11y | `chromium-e2e`, `chromium-a11y`     | Real browser journeys + axe                          |
| Cross-browser render  | `firefox-render`, `webkit-render`   | Pages paint chrome/content outside Chromium          |
| Visual regression     | `chromium-visual` (opt-in)          | Screenshot baselines — not in default `npm test` yet |
| Coverage gate         | `npm run test:frontend-coverage`    | 100% L/F/B on manage `src` (exclusions apply)        |

## Commands

```bash
# from repo root
npm test
npm run test:e2e
npm run test:frontend-coverage
npm run playwright:install   # once per machine
npm run test:visual          # optional
```

> **Prerequisite:** the Playwright projects (e2e / a11y / render) boot a test server on port 8091 that queries the **real local database** — the specs deep-link to rows from the dev seed (`e2e/fixtures.ts` defines `SAMPLE_CASE_ID`, `SAMPLE_RULESET_ID`). Run `npm start` first (or at least `docker compose up -d` + `npm run db-migrate-dev && npm run db-seed`) or the journey specs will fail. The unit/`node --test` layers mock or stub the DB and work without it.

Lighter manage-only example:

```bash
npm run test --workspace identify-consultees-manage -- src/app/views/home/controller.test.ts
```

## Coverage expectations

For `apps/manage/src/**`:

- **100%** line, function, and branch coverage in the frontend gate
- Excludes typically include `server.ts`, `util/build.ts`, and `*.test.*`

If you add a branch, add a test. Prefer testing through handlers / `create-test-app` over brittle private internals.

## How to add or change tests for a route

1. **Unit:** Extend or add `*.test.ts` beside the controller/router; mock `ManageService` pieces as existing tests do
2. **HTTP wiring:** Assert status, redirect `Location`, and key body strings via `supertest` (`router.test.ts` pattern)
3. **Template a11y:** Render the Nunjucks view in `pages.a11y.test.ts` with a representative view-model
4. **Playwright:** Add/adjust paths in `apps/manage/e2e/*.spec.ts` (e2e, a11y, render)
5. Run the manage coverage gate before opening the PR

Auth-disabled test app helpers live under `apps/manage/src/app/testing/`.

## Related pages

- [Accessibility and quality](./accessibility-and-quality.md)
- [Troubleshooting](./troubleshooting.md)
