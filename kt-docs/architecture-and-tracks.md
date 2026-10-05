# Architecture and tracks

**Status:** Partial — track names below are KT labels mapped onto this monorepo; they are not always spelled “Track A/B/C” in code.

## Monorepo shape (frontend-relevant)

| Path                   | Role                                                                     |
| ---------------------- | ------------------------------------------------------------------------ |
| `apps/manage`          | Express + Nunjucks + GOV.UK Frontend web app (primary frontend)          |
| `apps/function-python` | Python Azure Function (`consultee-areas`) called by some manage pages    |
| `apps/function`        | Separate Node Azure Function app (not the main UI)                       |
| `packages/database`    | Prisma schema, migrations, geospatial SQL helpers, seed/import tooling   |
| `packages/lib`         | Shared library code (placeholder today)                                  |
| `infrastructure`       | Azure / Terraform (App Service container for web, Front Door, SQL, etc.) |

## Track A — Node UI

**Intent:** A government-shaped UI running the identify-consultees journey end to end: search project boundaries → pick a ruleset → run it → review matched consultees on a map and in a table.

**In this repo:**

- Homepage search + paginated list over `case_boundary` via `searchCaseBoundaries` (`packages/database/src/geospatial`)
- Ruleset picker at `/consultees/:caseId`, results at `/consultees/:caseId/results?ruleset=…`
- Results run the ruleset's conditions as SQL `GEOGRAPHY` queries (`runRuleset`) and render matches on an interactive map with a static-image fallback
- Component showcase at `/components` (GOV.UK macros + `/components/interactive-map` worked Defra examples)
- Admin data-loading routes under `/admin/` (upload file to blob, import reference data into SQL)

**Important guidance for everyone:**

> The main journey is **database-backed**, not fixture-backed. Rows on the homepage and matches on the results page come from SQL (`case_boundary` / `consultee_area`). Locally that data is the dev seed (`npm run db-seed`, run automatically by `npm start`); in Dev/Test/Training it can be the full reference dataset (see below). An unreachable or empty database means empty results — pages degrade with logged errors rather than fixtures.

## Track B — Python-to-TypeScript (HTTP) bridge

**Intent:** Keep geospatial / SQL-heavy Python work in a Function app, and let the Node UI call it over HTTP.

**In this repo:**

- Manage config: optional `PYTHON_FUNCTION_URL` + `PYTHON_FUNCTION_API_KEY`
- UI routes: `/consultee-areas-python` (GET form + POST run, calls the function with an `x-api-key` header) and `/consultee-areas-direct` (same query straight from Node — the no-Python sibling page)
- Python app: `apps/function-python` querying `consultee_area` via pymssql, `x-api-key` shared secret checked in `function_app.py`

**Fallback rule:** Missing Python environment, misconfigured URL, or stopped database must **not** take down the manage app. The bridge page shows an error message; other routes continue.

See [Node–Python integration](./node-python-integration.md).

## Track C — SQL spatial database

**Intent:** Persist geometries (`case_boundary`, `consultee_area`) in SQL Server `GEOGRAPHY` columns and run spatial screening there.

**In this repo:**

- Local Docker SQL Server (host port **1434**) via `docker compose`
- Prisma + raw geospatial helpers under `packages/database/src/geospatial` (`case-boundaries`, `consultee-areas`, `rulesets`, `wkt`)
- Ruleset definitions built from a CSV export (`example_ruleset.csv`); conditions run as `STIntersects` / `STDistance` / bordering queries
- Dev seed loads a real sample of UK boundaries (`npm run db-seed`); full datasets land via `npm run db-import`, `npm run db-import-from-blob`, the DB Seed pipeline's `loadFullReferenceData` option, or `/admin/import-reference-data`
- `/items` pings the DB with `SELECT 1` as a connectivity smoke page

Track C is now on the critical path for the main journey: `npm start` brings the DB up and seeds it for a full local stack.

## How the tracks interact

```
Browser
  └─ Azure Front Door (deployed) / localhost (local)
       └─ apps/manage (Track A UI)
            ├─ packages/database → SQL Server (Track C; seeded sample data locally)
            └─ optional HTTP: PYTHON_FUNCTION_URL → apps/function-python (Track B)
                                    └─ same SQL (Track C)
```

## Journey data sources

| Journey                      | Track    | Data source                                                |
| ---------------------------- | -------- | ---------------------------------------------------------- |
| Home search / select project | C        | `case_boundary` via `searchCaseBoundaries`                 |
| Ruleset picker               | C        | Case summary + `RULESETS` (CSV-built, `packages/database`) |
| Consultees results + maps    | C        | `runRuleset` spatial matches + case geometry               |
| Map layers demo              | A        | Demo GeoJSON (`map-layers-demo-geojson.ts`)                |
| Component showcase           | A        | Static examples (Defra map uses sample GeoJSON)            |
| Consultee areas (Python)     | B (+ C)  | Python function → SQL                                      |
| Consultee areas (direct)     | C        | Node → SQL (`listConsulteeAreas`)                          |
| Items list                   | C smoke  | DB ping + placeholder tasks                                |
| Admin upload / import        | C + blob | Blob container → `consultee_area` / `case_boundary`        |
| End-user upload wizard       | —        | Not implemented in manage UI yet                           |

## Related pages

- [Routes and user journeys](./routes-and-user-journeys.md)
- [Search and filtering](./search-and-filtering.md)
- [Deployment and environments](./deployment-and-environments.md)
