# Local setup

**Status:** Current for Node/npm/SQL; Partial for Python (venv/pip today — **uv is not required** by this repo yet).

## Required versions

| Tool                       | Version               | Where pinned                                                |
| -------------------------- | --------------------- | ----------------------------------------------------------- |
| Node.js                    | **22.23.2**           | `.nvmrc`, `package.json` `engines`, Azure pipelines         |
| npm                        | **10.9.8**            | Bundled with Node 22.23.2; `packageManager` / `engines.npm` |
| Docker                     | Recent stable         | Local SQL Server container                                  |
| Python                     | **3.12**              | `apps/function-python` / Azure Function config              |
| Azure Functions Core Tools | **v4**                | Optional; only for Track B locally                          |
| Azurite                    | Latest via npm global | Optional storage emulator for Functions                     |

> **uv:** Not part of the current documented toolchain. Local Python setup uses `python3 -m venv` and `pip install -r requirements.txt`. If the team later standardises on uv, update this page and `apps/function-python/README.md` together.

Do **not** regenerate `package-lock.json` with Node 24 / npm 11. See root `AGENTS.md` toolchain section.

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
nvm use          # → 22.23.2
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
5. Start the manage app in watch mode

Stop the app with `Ctrl+C`. Stop SQL with `docker compose down` when finished.

## Environment configuration

Templates:

- `apps/manage/.env.example`
- `packages/database/.env.example`

Key manage variables:

| Variable                | Local note                                          |
| ----------------------- | --------------------------------------------------- |
| `AUTH_DISABLED`         | `true` for day-one UI work                          |
| `SQL_CONNECTION_STRING` | Docker SA user; host port **1434**                  |
| `PYTHON_FUNCTION_URL`   | Default `http://localhost:7071/api/consultee-areas` |
| `SESSION_SECRET`        | Local placeholder only                              |
| `LOG_LEVEL`             | Often `debug` locally (includes Prisma query logs)  |

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
npm test   # heavy; see Testing page for lighter targets
```

## Related pages

- [Troubleshooting](./troubleshooting.md)
- [Deployment and environments](./deployment-and-environments.md)
- [Node–Python integration](./node-python-integration.md)
