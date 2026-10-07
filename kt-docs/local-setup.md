# Local setup

**Status:** Current for Node/npm/SQL; Partial for Python (venv/pip today — **uv is not required** by this repo yet).

## Required versions

| Tool                       | Version                | Where pinned                                                                      |
| -------------------------- | ---------------------- | --------------------------------------------------------------------------------- |
| Node.js                    | **24.x** (current LTS) | `.nvmrc` / `.tool-versions` (`24`), `engines.node` `^24`, Azure `nodeVersion: 24` |
| npm                        | **11.x+** (bundled)    | Ships with Node 24; `engines.npm` `>=11` floor only — never patch-pinned          |
| Docker                     | Recent stable          | Local SQL Server container                                                        |
| Python                     | **3.12**               | `apps/function-python` / Azure Function config                                    |
| Azure Functions Core Tools | **v4**                 | Optional; only for Track B locally                                                |
| Azurite                    | Latest via npm global  | Optional storage emulator for Functions                                           |

> **uv:** Not part of the current documented toolchain. Local Python setup uses `python3 -m venv` and `pip install -r requirements.txt`. If the team later standardises on uv, update this page and `apps/function-python/README.md` together.

Do **not** regenerate `package-lock.json` under a different Node/npm major (e.g. Node 26 / npm 12) — minor/patch releases within the 24 line are always fine. See root `AGENTS.md` toolchain section.

## Why React and Preact appear in `package.json`

The manage UI is **GOV.UK Frontend + Nunjucks + vanilla JavaScript only** — no app code imports React or Preact. Those entries exist so `npm ci` can satisfy transitive peer dependencies:

- `optionalDependencies` → `react`, `react-dom`, `scheduler`: required peers of `@prisma/studio-core` (a `prisma` CLI dependency, used for `prisma studio`) and the `@visx` / `@radix-ui` packages it brings. Keeping them pinned prevents “Missing: react@… from lock file” failures in Azure `npm ci`.
- `overrides.preact` → `^10.29.8`: `@defra/interactive-map` ships Preact-compiled code, while `accessible-autocomplete` asks for `preact@^8`. The override resolves both to the v10 line.

They can only be removed alongside the underlying dependencies — see the `AGENTS.md` toolchain section and [Troubleshooting](./troubleshooting.md).

## Install and start (happy path)

From a clean clone:

```bash
git clone git@github.com:Planning-Inspectorate/identify-consultees.git
cd identify-consultees
nvm use          # → latest Node 24.x
node -v && npm -v
npm ci
npm start
```

Open **http://localhost:8090**.

`npm start` (`scripts/start-local.mjs`) will:

1. Create missing env files from examples (`packages/database/.env`, `apps/manage/.env`)
2. Default local manage auth to disabled and point SQL at Docker
3. Start SQL (`docker compose up -d`) and wait on **localhost:1434**
4. Run Prisma migrations
5. Seed the database with the bundled sample of UK case boundaries and consultee areas (`npm run db-seed` — re-runnable; rows merge rather than duplicate)
6. Start the manage app in watch mode

Stop the app with `Ctrl+C`. Stop SQL with `docker compose down` when finished.

The seed data is what the homepage search, the `/consultees/:caseId` journey, and the Playwright e2e tests run against — an empty database means empty search results and failing e2e specs.

## Environment configuration

Templates:

- `apps/manage/.env.example`
- `packages/database/.env.example`

Key manage variables:

| Variable                                   | Local note                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `AUTH_DISABLED`                            | `true` for day-one UI work                                                     |
| `SQL_CONNECTION_STRING`                    | Docker SA user; host port **1434**                                             |
| `PYTHON_FUNCTION_URL`                      | Default `http://localhost:7071/api/consultee-areas`                            |
| `PYTHON_FUNCTION_API_KEY`                  | Optional locally; in Azure the shared `x-api-key` secret the function requires |
| `BLOB_STORE_HOST` / `BLOB_STORE_CONTAINER` | Optional; enables `/admin/upload-to-blob` + `/admin/import-reference-data`     |
| `SESSION_SECRET`                           | Local placeholder only                                                         |
| `LOG_LEVEL`                                | Often `debug` locally (includes Prisma query logs)                             |
| `MANAGED_REDIS_URL`                        | Optional; unset means in-memory sessions locally                               |

Never commit `.env` files or production secrets.

## Optional: Python function

Only needed for `/consultee-areas-python` and similar bridge pages.

See `apps/function-python/README.md`. Short version:

```bash
cd apps/function-python
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# create local.settings.json with SQL_CONNECTION_STRING
# run azurite elsewhere, then:
func start
```

## Optional: Entra auth

Set `AUTH_DISABLED=false` and fill MSAL-related values in `apps/manage/.env`. Confirm client / group IDs with the team before use.

## Quality checks after setup

```bash
npm run check-toolchain
npm run lint
npm run check-types
npm test   # heavy; needs the seeded local DB for e2e — see Testing page for lighter targets
```

## Related pages

- [Troubleshooting](./troubleshooting.md)
- [Deployment and environments](./deployment-and-environments.md)
- [Node–Python integration](./node-python-integration.md)
