# Local development

Start with the [README](../README.md): `nvm use`, `npm ci`, `npm start`. This page covers what it sets up, configuration, and fixing common problems.

## What `npm start` runs

`scripts/start-local.mjs`:

1. Creates `packages/database/.env` and `apps/manage/.env` from their `.env.example` files if missing (auth disabled, SQL pointed at Docker)
2. Starts SQL Server in Docker (`docker compose up -d`) on **localhost:1434** and waits for it
3. Runs migrations and seeds the sample dataset (`npm run db-seed`; safe to re-run, rows merge)
4. Starts the Python function on **localhost:7071**: creates `apps/function-python/.venv` (Python 3.12) if missing, installs `requirements.txt`, and gives the function and the web app the same local API key
5. Starts the web app in watch mode on **localhost:8090**

`Ctrl+C` stops the app and the function. `docker compose down` stops SQL.

The function needs Azure Functions Core Tools (`npm install -g azure-functions-core-tools@4`). Without them `npm start` warns and carries on, and project pages show "The ruleset could not be run".

## Toolchain

| Tool    | Version                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------- |
| Node.js | 24.x, from `.nvmrc`. `engines` enforces `^24`                                                               |
| npm     | 11+, bundled with Node 24                                                                                   |
| Docker  | Recent; SQL Server needs `GEOGRAPHY`, so not Azure SQL Edge. On Apple Silicon it runs under amd64 emulation |
| Python  | 3.12, for the function                                                                                      |

Don't regenerate `package-lock.json` under another Node or npm major. `react`, `react-dom` and `scheduler` (optional dependencies) and the `preact` override aren't a UI stack: they satisfy peer dependencies of the Prisma CLI and the Defra map so Azure's `npm ci` passes. See the toolchain section of [AGENTS.md](../AGENTS.md).

## Configuration

`apps/manage/.env` (template: `.env.example`):

| Variable                                  | Locally                                                                                                                                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_DISABLED`                           | `true`. For real Entra sign-in set `false`, get `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` and `AUTH_GROUP_APPLICATION_ACCESS` from a teammate, check `AUTH_TENANT_ID` and `APP_HOSTNAME`, and restart |
| `SQL_CONNECTION_STRING`                   | Docker, port 1434                                                                                                                                                                                  |
| `PYTHON_FUNCTION_URL`                     | `http://localhost:7071/api/consultee-areas`. `run-ruleset` is resolved next to it                                                                                                                  |
| `PYTHON_FUNCTION_API_KEY`                 | Set by `npm start` to match the function's `CONSULTEE_AREAS_API_KEY`                                                                                                                               |
| `BLOB_STORE_HOST`, `BLOB_STORE_CONTAINER` | Unset. Needed only for the admin upload and import pages                                                                                                                                           |
| `NEARBY_CONSULTEE_RADIUS_KM`              | Unset (20)                                                                                                                                                                                         |
| `MANAGED_REDIS_URL`                       | Unset: sessions in memory                                                                                                                                                                          |
| `LOG_LEVEL`                               | `debug` shows Prisma queries                                                                                                                                                                       |

Never commit `.env` or `local.settings.json`.

To run the function by hand: `cd apps/function-python`, activate `.venv`, then `func start`. Its `local.settings.json` needs `SQL_CONNECTION_STRING` and `CONSULTEE_AREAS_API_KEY`. See its [README](../apps/function-python/README.md).

## Troubleshooting

| Symptom                                                           | Fix                                                                                                                        |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `npm ci` fails on engines                                         | `nvm use`, then `npm run check-toolchain`                                                                                  |
| "The ruleset could not be run" on every project                   | The function isn't running, the URL is wrong, or the API keys differ. Check `npm start`'s log for `run-ruleset` 401 or 500 |
| `npm start` says `func` not found                                 | `npm install -g azure-functions-core-tools@4`                                                                              |
| Homepage search shows nothing                                     | The database isn't seeded: `npm run db-seed`                                                                               |
| A project page 404s                                               | The URL needs the case boundary's id (a UUID), not its case reference                                                      |
| Migrations fail                                                   | SQL isn't ready yet; wait, then `npm run db-migrate-dev`                                                                   |
| `No command registered for 'migrate'`                             | The `prisma` CLI has moved ahead of `@prisma/client`. Put them on the same major and `npm ci`                              |
| e2e journeys fail                                                 | They need the seeded local database. Run `npm start` once first                                                            |
| Interactive map is blank                                          | Check the browser console, CSP and the `/vendor/*` routes                                                                  |
| Only the static map shows                                         | JS is off or the map failed to start; check that the page config's `fallback.src` returns 200                              |
| Page references a missing asset (404) after editing `src/public/` | Restart the dev server. If a port is stuck, see "Asset fingerprinting" in [AGENTS.md](../AGENTS.md)                        |
