# Identify consultees

This is the monorepo for the Identify consultees service — a GIS tool for identifying consultees and managing the associated data.

| Path | Purpose |
| ---- | ------- |
| `apps/manage` | Web app (Express + Nunjucks + GOV.UK Frontend) |
| `apps/function-python` | Python Azure Function (`consultee-areas`) used by some manage pages |
| `apps/function` | Node Azure Function app |
| `packages/database` | Prisma schema, migrations, and data access |
| `packages/lib` | Shared library code |
| `infrastructure` | Azure / Terraform |

## Prerequisites

- **Node.js 24.x** — the current LTS (see [`.nvmrc`](./.nvmrc); `package.json` `engines` `^24` and Azure Pipelines `nodeVersion: 24` pin the same major). Use the latest 24.x — the patch is not pinned.
- **npm 11.x+** (ships with Node 24 — use the bundled version, not a self-installed npm)
- **Docker** (local SQL Server with spatial types — see [`docker-compose.yml`](./docker-compose.yml))
- Git access to this repository

On Apple Silicon, the SQL Server image runs under `linux/amd64` emulation. That is expected and required: Azure SQL Edge does not support the `GEOGRAPHY` type this project uses.

Confirm the toolchain after install:

```bash
nvm use
node -v    # v24.x.y
npm -v     # 11.x.y
npm run check-toolchain
```

## Getting started (new developer)

From a clean clone, these steps are enough to run the manage app locally:

```bash
git clone git@github.com:Planning-Inspectorate/identify-consultees.git
cd identify-consultees
nvm use   # latest Node 24.x from .nvmrc
npm ci
npm start
```

Then open **http://localhost:8090**.

`npm start` runs [`scripts/start-local.mjs`](./scripts/start-local.mjs), which:

1. Creates env files if they are missing:
   - `packages/database/.env` from `.env.example`
   - `apps/manage/.env` from `.env.example`, with `AUTH_DISABLED=true` and a local SQL connection string
2. Repairs older local setups if needed (SQL host port `1433` → `1434`; adds `PYTHON_FUNCTION_URL` when missing)
3. Starts the database container (`docker compose up -d`)
4. Waits for SQL Server on **localhost:1434**
5. Runs migrations (`npm run db-migrate-dev`)
6. Seeds the database (`npm run db-seed`) with a real sample of UK case boundaries and consultee areas — the main search → ruleset → results journey and the Playwright e2e tests need this data
7. Starts the manage app in watch mode

Stop with `Ctrl+C`. The SQL container keeps running until you stop it (`docker compose down`).

### What you get by default

| Setting | Local default |
| ------- | ------------- |
| Manage app | http://localhost:8090 |
| SQL Server | `localhost:1434` (container maps host `1434` → container `1433`) |
| Auth | Disabled (`AUTH_DISABLED=true` when `.env` is created by `npm start`) |
| `PYTHON_FUNCTION_URL` | `http://localhost:7071/api/consultee-areas` (Azure Functions Core Tools) |

Do not commit `.env` files. Copy from the `.env.example` files only as a template.

### Seed data

`npm start` seeds automatically. To re-seed later (the seed is idempotent — rows are merged, not duplicated):

```bash
npm run db-seed
```

The dev seed loads a real sample of UK infrastructure case boundaries and consultee-area reference data (from `apps/function-python/setup_database/sample_data`) into `case_boundary` and `consultee_area`. Without it the homepage search returns nothing and the e2e suite fails.

To load the full reference dataset instead, use `npm run db-import` / `npm run db-import-from-blob` — see the "Database operations" section of [AGENTS.md](./AGENTS.md).

### Optional: Entra authentication

For real Microsoft Entra sign-in locally:

1. In `apps/manage/.env`, set `AUTH_DISABLED=false`
2. Fill in `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, `AUTH_GROUP_APPLICATION_ACCESS`, and confirm `AUTH_TENANT_ID` / `APP_HOSTNAME` with a teammate
3. Restart the manage app

### Optional: Python function (consultee-areas)

The manage app can start without the Python function running. You only need it for pages that call `PYTHON_FUNCTION_URL` (for example `/consultee-areas-python`).

Full setup is in [`apps/function-python/README.md`](./apps/function-python/README.md). In short: Python 3.12, venv, Azure Functions Core Tools, Azurite, then `func start` in `apps/function-python` so the endpoint is available at `http://localhost:7071/api/consultee-areas`.

### Running pieces separately

If you prefer not to use `npm start`:

```bash
# env files (or copy from the .env.example files yourself)
cp packages/database/.env.example packages/database/.env
cp apps/manage/.env.example apps/manage/.env
# then set AUTH_DISABLED=true and SQL_CONNECTION_STRING for local Docker (port 1434)

docker compose up -d
npm run db-migrate-dev
npm run dev --workspace identify-consultees-manage
```

Useful npm scripts from the repo root:

| Script | Purpose |
| ------ | ------- |
| `npm start` | Full local bootstrap (env, DB, migrate, seed, manage app) |
| `npm run db-migrate-dev` | Apply Prisma migrations (dev) |
| `npm run db-seed` | Seed the database (sample boundary data) |
| `npm run db-import -- --type=<consultee-areas\|case-boundaries> --file=<path>` | Import a GeoJSON dataset from a local file |
| `npm run db-import-from-blob -- --type=<...> --blob=<name>` | Import a GeoJSON dataset from the app's blob container |
| `npm run lint` / `npm test` / `npm run check-types` | Local quality checks |

`npm test` includes Playwright e2e, which needs the seeded local database — run `npm start` first (or leave the SQL container up from an earlier run).

Frontend testing (unit, GOV.UK fixtures, a11y, Playwright e2e, coverage gate, and optional visual regression) is documented in [`docs/frontend-testing.md`](./docs/frontend-testing.md). Install Chromium, Firefox, and WebKit once with `npm run playwright:install` before browser tests.

For contribution workflow (branches, commits, PRs) see [CONTRIBUTING.md](./CONTRIBUTING.md). To report a security vulnerability see [SECURITY.md](./SECURITY.md). Agent / GDS guidance for this repo lives in [AGENTS.md](./AGENTS.md). Deeper onboarding material (architecture, routes, maps, testing, troubleshooting) lives in [`kt-docs/`](./kt-docs/README.md).

## Editor setup

The root [`tsconfig.json`](./tsconfig.json) stays compatible with Cursor / VS Code’s bundled TypeScript language service. Stricter checks such as `erasableSyntaxOnly` live in [`tsconfig.check.json`](./tsconfig.check.json) and run via `npm run check-types` (TypeScript 7 from `@typescript/native`).

Optional: `.vscode` points `typescript.tsdk` at `node_modules/@typescript/old/lib`. If prompted, choose **Use Workspace Version** for workspace-aligned IntelliSense.

## WebStorm Run Configurations

Run configurations are included for most of the npm scripts. Node and npm must be configured for the project for them to work.
Go to Settings > Languages and Frameworks > Node.js and set the Node interpreter and package manager.
