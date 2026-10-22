# Manage

The web app: server-rendered GOV.UK Frontend (Express, Nunjucks, plain JavaScript). Users find a case's boundary, pick a ruleset, review the consultees it identifies on a map, and download the report.

`npm start` from the repo root runs it on http://localhost:8090 (see the [root README](../../README.md)).

| Script (`--workspace identify-consultees-manage`) | What |
| ------------------------------------------------- | ---- |
| `npm run dev` | Build assets and run the server in watch mode |
| `npm run build` | Build fingerprinted assets into `src/.static` |
| `npm test` | Unit and integration tests (`node --test`) |
| `npm run test:coverage` | The 100% line, branch and function gate for `src/**` |
| `npm run test:e2e` | Playwright journeys, accessibility and rendering (needs the seeded database) |

Routes, journeys and the report: [`kt-docs/web-app.md`](../../kt-docs/web-app.md). Tests: [`kt-docs/testing.md`](../../kt-docs/testing.md).
