# Identify consultees

The monorepo for the Identify consultees service: finds who must be consulted about a Nationally Significant Infrastructure Project by screening its site boundary against consultee areas.

| Path | Purpose |
| ---- | ------- |
| `apps/manage` | Web app (Express + Nunjucks + GOV.UK Frontend) |
| `apps/function-python` | Python Azure Function: runs the screening (`run-ruleset`) |
| `packages/database` | Prisma schema, migrations, geospatial SQL, rulesets, seed and import |
| `infrastructure` | Azure / Terraform |

## Prerequisites

- **Node.js 24.x** and the **npm 11.x** it ships with ([`.nvmrc`](./.nvmrc); `engines` and Azure Pipelines pin the same major)
- **Docker**, for SQL Server with spatial types. On Apple Silicon it runs under `linux/amd64` emulation; Azure SQL Edge doesn't support `GEOGRAPHY`
- **Python 3.12** and [Azure Functions Core Tools](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local) (`npm install -g azure-functions-core-tools@4`), for the screening function

## Getting started

```bash
git clone git@github.com:Planning-Inspectorate/identify-consultees.git
cd identify-consultees
nvm use
npm run check-toolchain
npm ci
npm start
```

Then open **http://localhost:8090**. `npm start` creates the `.env` files (auth disabled), starts SQL Server in Docker on port 1434, migrates and seeds a real sample of UK boundaries, starts the Python function on port 7071 and the web app in watch mode. `Ctrl+C` stops the app and function; `docker compose down` stops SQL.

Without the function, the app still runs but project pages say "The ruleset could not be run". Configuration, Entra sign-in and troubleshooting: [`kt-docs/local-development.md`](./kt-docs/local-development.md).

| Script | Purpose |
| ------ | ------- |
| `npm start` | Full local bootstrap |
| `npm run db-migrate-dev` | Apply Prisma migrations |
| `npm run db-seed` | Seed the sample data (merges, safe to re-run) |
| `npm run db-import -- --type=<consultee-areas\|case-boundaries> --file=<path>` | Import a GeoJSON file |
| `npm run db-import-from-blob -- --type=<...> --blob=<name>` | Import a GeoJSON blob from the app's container |
| `npm run lint` / `npm run check-types` / `npm run format-prettier-check` | Static checks |
| `npm test` | Unit tests, the 100% frontend coverage gate and Playwright (needs the seeded database) |
| `npm run playwright:install` | Install Chromium, Firefox and WebKit, once |

## Where to read next

- [`kt-docs/`](./kt-docs/README.md): how the service works and how to work on it
- [CONTRIBUTING.md](./CONTRIBUTING.md): branches, commits and PRs
- [AGENTS.md](./AGENTS.md): GDS, maps, toolchain and PR rules (for agents and people)
- [ACCESSIBILITY.md](./ACCESSIBILITY.md), [SECURITY.md](./SECURITY.md)

## Editor setup

The root [`tsconfig.json`](./tsconfig.json) stays compatible with the VS Code / Cursor TypeScript service. Stricter checks (`erasableSyntaxOnly`) live in [`tsconfig.check.json`](./tsconfig.check.json) and run with `npm run check-types` (TypeScript 7, `@typescript/native`). `.vscode` points `typescript.tsdk` at `node_modules/@typescript/old/lib`; choose **Use Workspace Version** if prompted.

WebStorm run configurations are included for most npm scripts; set the Node interpreter and package manager under Settings > Languages and Frameworks > Node.js.
