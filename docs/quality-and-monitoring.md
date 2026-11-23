# Quality and monitoring

Where the non-functional guards live and, for the ones that are deliberately not in CI, why.

## In the pipeline today

- **Coverage** — hard 100% line/function/branch gates: `test:packages-coverage` for `packages/database/src` and `scripts/`, `run-frontend-coverage.mjs` for `apps/manage/src`, `--cov-fail-under=100` for `apps/function-python`.
- **Asset integrity** — `check-fingerprints` (committed literals vs a fresh build) and `check-asset-sizes` (bundle budgets) after `npm run build`; `e2e/pages.assets.e2e.spec.ts` asserts every referenced asset serves immutable + Brotli.
- **Security** — `npm audit --audit-level=high` in the parallel static checks; `e2e/pages.security.e2e.spec.ts` asserts the OWASP headers on real responses.
- **Contracts** — `contracts/run-ruleset/` pins the manage app ↔ Python function wire format; both sides' tests read it.

## Database-dependent tests must not skip in CI

`packages/database/src/db-test-skip.ts` is the single skip helper: locally a missing SQL
Server means `t.skip`, but under `CI`/`TF_BUILD` it **fails** — the pipeline's container
bring-up guarantees the database, so a skip means the bring-up or `SQL_CONNECTION_STRING` is
broken. A silent skip otherwise reads as an unrelated-looking coverage miss, or worse, a
quietly unrun suite. Intentional skips don't use the helper: the CI-only seed suites skip by
checking `!CI && !TF_BUILD`, and `ruleset-runner.golden.test.ts` skips in CI too because it
needs the full reference dataset plus the running Python function.

## Load smoke (manual)

`npm run load:smoke` hits the ruleset-run report page — the service's slowest request — so
each request pays for a real run (`LOAD_BASE_URL`, `LOAD_REQUESTS`, `LOAD_CONCURRENCY`,
`LOAD_CASE_ID`, `LOAD_RULESET`, `LOAD_COOKIE`). Run it deliberately when changing the run
path, the database plan, or session caching; it is not a CI gate because percentiles on
shared agents are noise.

The report page needs sign-in, so the target matters. A dev server started with
`AUTH_DISABLED=true` (the local default) takes the smoke as-is: each request is a fresh
session and runs the ruleset rather than reading the session's stored result. An
environment needs a signed-in session's cookie — sign in through the browser, copy the
`connect.sid` value from dev tools, and pass `LOAD_COOKIE='connect.sid=…'`. Every request
then shares the one session, whose stored run — keyed on the case and ruleset — would serve
all but the first, so the smoke rotates the requested ruleset (unless `LOAD_RULESET` pins
one) to keep each request a real run, and reports per ruleset rather than blending their
different costs. Under concurrency a request can still occasionally land on a just-stored
run — overlapping requests race the session's single slot — so read p95/max as the signal.
A dead or expired cookie fails loudly as sign-in redirects rather than timing the login
page.

## Evaluated and deferred

- **Mutation testing** — Stryker has no released `node:test` runner
  ([issue #5421](https://github.com/stryker-mutator/stryker-js/issues/5421),
  [PR #6020](https://github.com/stryker-mutator/stryker-js/pull/6020)); the tap-runner
  workaround reports mutants as uncovered and is unreliable. Revisit when a `node:test`
  runner ships — the 100% coverage gate proves lines execute, not that assertions are
  meaningful, and `src/util/` would be the first target.
- **Visual tests in CI** — `chromium-visual` is configured but opt-in while the UI is still
  changing (see `e2e/pages.visual.spec.ts` for the determinism notes). Enabling it means
  generating Linux baselines on the CI OS and wiring the project into `pr.yml`; do that when
  the page set stops churning.

## Live-service monitoring (Service Standard)

Outside the pipeline but expected of a live service — raise with the platform team rather
than implement ad hoc:

- **Synthetic availability** — an external check on `/health` (and the function's `/api/health`)
  through Front Door, alerting on sustained non-200; the origin is private so the check must
  come from outside the VNet.
- **Real-user monitoring** — Web Vitals (LCP, INP, CLS) collection. The year-long immutable
  caching on fingerprinted assets makes repeat visits fast; RUM is how we'd verify that and
  catch a slow ruleset run in the field rather than in a smoke test.
