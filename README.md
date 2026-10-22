# Identify consultees

Finds who must be consulted about a Nationally Significant Infrastructure Project, by screening its site boundary against consultee areas.

| Path | What |
| ---- | ---- |
| `apps/manage` | Web app: Express, Nunjucks, GOV.UK Frontend |
| `apps/function-python` | Python Azure Function: runs the screening, and reads CBOS |
| `packages/database` | Prisma schema, migrations, geospatial SQL, rulesets, data import |
| `config` | **What the service does**: rulesets, report, map and distance settings. See [`config/README.md`](./config/README.md) |
| `infrastructure` | Terraform for Azure |

## Run it locally

You need Node.js 24 ([`.nvmrc`](./.nvmrc)), Docker, Python 3.12 and Azure Functions Core Tools (`npm install -g azure-functions-core-tools@4`).

```bash
nvm use
npm run check-toolchain
npm ci
npm start
```

Then open http://localhost:8090. `npm start` writes the `.env` files (sign-in disabled), starts SQL Server in Docker on port 1434, migrates and seeds it, and runs the Python function (port 7071) and the web app. `Ctrl+C` stops them; `docker compose down` stops SQL Server.

> **`npm start` and `npm run db-seed` replace the consultee areas in use with the 80-area sample.** Case boundaries are merged. If you've loaded the full reference data locally, apply migrations with `npm run db-migrate-prod` and start the app and function without `npm start`.

On Apple Silicon, SQL Server runs under `linux/amd64` emulation (Azure SQL Edge has no `GEOGRAPHY`). Sign-in, settings and troubleshooting: [`kt-docs/local-development.md`](./kt-docs/local-development.md).

## Scripts

| Script | What |
| ------ | ---- |
| `npm start` | Everything above |
| `npm run db-migrate-prod` | Apply migrations. To write one, see [`packages/database/src/README.md`](./packages/database/src/README.md) |
| `npm run db-seed` | Load the sample data (replaces the consultee areas in use) |
| `npm run db-import -- --type=<consultee-areas\|case-boundaries> --file=<path>` | Import a GeoJSON file |
| `npm run db-import-from-blob -- --type=<...> --blob=<name>` | Import a GeoJSON blob from the app's storage |
| `npm run lint`, `npm run check-types`, `npm run format-prettier-check` | Static checks |
| `npm test` | Unit tests, the 100% coverage gate and Playwright (needs the seeded database) |
| `npm run playwright:install` | Install the Playwright browsers, once |

## Read next

- [`kt-docs/`](./kt-docs/README.md): how the service works, starting with the [overview](./kt-docs/overview.md)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md): branches, commits and PRs
- [`AGENTS.md`](./AGENTS.md): GDS, maps, toolchain and PR rules, for agents and people
- [`ACCESSIBILITY.md`](./ACCESSIBILITY.md), [`SECURITY.md`](./SECURITY.md)

## Editors

`npm run check-types` uses [`tsconfig.check.json`](./tsconfig.check.json) (stricter, TypeScript 7). The root [`tsconfig.json`](./tsconfig.json) stays compatible with the editor's TypeScript service: in VS Code or Cursor, choose **Use Workspace Version** if asked. WebStorm run configurations are included; set the Node interpreter under Settings > Languages and Frameworks > Node.js.
