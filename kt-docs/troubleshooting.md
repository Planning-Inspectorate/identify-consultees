# Troubleshooting

**Status:** Current for common local issues; expand as the team hits new failure modes.

## Setup and toolchain

| Symptom                            | Likely cause                     | Fix                                                                                              |
| ---------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `engine-strict` / install fails    | Wrong Node/npm                   | `nvm use` → latest Node 24.x / bundled npm 11+; `npm run check-toolchain`                        |
| Azure `npm ci` missing react peers | Lockfile regenerated incorrectly | Keep root `optionalDependencies` for react/react-dom/scheduler; do not enable `legacy-peer-deps` |
| Port conflicts on 1433             | Old SQL mapping                  | Local host port is **1434** → container 1433                                                     |

## Web app

| Symptom                          | Likely cause                                | Fix                                                   |
| -------------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| App won’t start                  | Missing `.env` / SQL string                 | Run `npm start` or copy `.env.example` files          |
| Auth loops locally               | `AUTH_DISABLED=false` without client config | Set `AUTH_DISABLED=true` for UI work                  |
| `ERR_ERL_PERMISSIVE_TRUST_PROXY` | `trust proxy` set to `true`                 | Use hop count `1` in `server.ts` (behind App Service) |
| Noisy `Prisma query` DEBUG logs  | Expected in non-production                  | Lower `LOG_LEVEL` or ignore locally                   |

## Maps / render

| Symptom                        | Likely cause                   | Fix                                                                          |
| ------------------------------ | ------------------------------ | ---------------------------------------------------------------------------- |
| Interactive map blank          | Vendor assets / JS / CSP       | Check browser console, CSP nonce, Defra vendor routes                        |
| Only static map shows          | JS disabled or init failure    | Confirm `data-static-map-src` returns 200                                    |
| Static map slow / flaky        | Upstream tiles uncached        | Confirm cache / ETag path; avoid prefetch storms                             |
| Interactive vs static disagree | Divergent viewports or GeoJSON | Both must derive from the same `buildCaseMapConfig` output / shared viewport |
| Static map looks wrong format  | `Accept` negotiation           | Raster route negotiates AVIF→WebP→PNG; use the `.svg` route for markup       |

## Python bridge

| Symptom                                | Likely cause                           | Fix                                                                |
| -------------------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| “Could not reach the Python function.” | Function not running or bad URL        | Start `func start`; verify `PYTHON_FUNCTION_URL`                   |
| Function runs but errors               | SQL not up / bad `local.settings.json` | `docker compose up -d`; match connection string to database `.env` |
| UI still works otherwise               | Expected                               | Track A is independent                                             |

## Database connectivity

| Symptom                          | Likely cause                                        | Fix                                                           |
| -------------------------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| Migrations fail                  | Container not ready                                 | Wait for healthy SQL on 1434; re-run `npm run db-migrate-dev` |
| Homepage search shows no results | `case_boundary` empty / not seeded                  | `npm run db-seed` (or `npm start`, which seeds)               |
| Results page 404s for a case     | `caseId` isn't a UUID, or the row isn't seeded      | Deep-link by case id from the homepage, not by case reference |
| e2e journey specs fail           | Seeded DB missing (server on 8091 queries real SQL) | `npm start` first; check `e2e/fixtures.ts` ids match the seed |
| `/items` fails                   | DB down                                             | Start compose; check connection string                        |

## Apple Silicon note

SQL Server image runs under `linux/amd64` emulation. That is expected — Azure SQL Edge is not used because this project needs `GEOGRAPHY`.

## Related pages

- [Local setup](./local-setup.md)
- [Maps](./maps.md)
- [Node–Python integration](./node-python-integration.md)
