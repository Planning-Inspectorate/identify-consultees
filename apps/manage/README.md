# Manage

The main web app for Identify consultees: a server-rendered GOV.UK Frontend service (Express +
Nunjucks + vanilla JS). Users search project boundaries (`case_boundary`), pick a ruleset, and
review the consultees it matches (`consultee_area`) on an interactive map with a static-image
fallback.

## Run

From the repo root, `npm start` sets up env files, brings up the local SQL Server container,
migrates, seeds the sample boundary dataset, and starts this app in watch mode on
**http://localhost:8090** — see the [root README](../../README.md).

This package's own scripts:

| Script | Purpose |
| ------ | ------- |
| `npm run dev --workspace identify-consultees-manage` | Build assets + watch-mode server |
| `npm run build --workspace identify-consultees-manage` | Build fingerprinted assets into `src/.static` |
| `npm test --workspace identify-consultees-manage` | Unit/integration tests (`node --test`) |
| `npm run test:e2e --workspace identify-consultees-manage` | Playwright e2e/a11y/render — needs the seeded local DB |
| `npm run test:coverage --workspace identify-consultees-manage` | 100% line/function/branch coverage gate for `src/**` |

## Further reading

- [`kt-docs/`](../../kt-docs/README.md) — the onboarding pack: architecture, routes, maps, testing, troubleshooting
- [`AGENTS.md`](../../AGENTS.md) — GDS rules, map/styling requirements, toolchain pins, integration gotchas
- [`docs/frontend-testing.md`](../../docs/frontend-testing.md) — the full test matrix
