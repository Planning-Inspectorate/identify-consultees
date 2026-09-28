# Architecture and tracks

**Status:** Partial — track names below are KT labels mapped onto this monorepo; they are not always spelled “Track A/B/C” in code.

## Monorepo shape (frontend-relevant)

| Path                   | Role                                                                     |
| ---------------------- | ------------------------------------------------------------------------ |
| `apps/manage`          | Express + Nunjucks + GOV.UK Frontend web app (primary frontend)          |
| `apps/function-python` | Python Azure Function (`consultee-areas`) called by some manage pages    |
| `apps/function`        | Separate Node Azure Function app (not the main UI)                       |
| `packages/database`    | Prisma schema, migrations, geospatial SQL helpers                        |
| `packages/lib`         | Shared library code                                                      |
| `infrastructure`       | Azure / Terraform (App Service container for web, Front Door, SQL, etc.) |

## Track A — Node UI and sample data

**Intent:** Ship a government-shaped UI quickly using **fixture / sample** project geometries and map polygons.

**In this repo:**

- Homepage list and search over `DUMMY_GEOMETRIES` (`apps/manage/src/app/data/dummy-geometries.ts`)
- Consultees results page built from dummy geometry metadata + sample GeoJSON helpers
- Ruleset options as static select items (not loaded from CBOS)

**Important guidance for everyone:**

> The main filter / project-selection journey is **sample-data-backed**, not database-backed. Do not assume rows on the homepage come from SQL. A live `case_boundary` count may influence the **total** displayed when there is no search query, but the table rows themselves are still fixtures today.

## Track B — Python-to-TypeScript (HTTP) bridge

**Intent:** Keep geospatial / SQL-heavy Python work in a Function app, and let the Node UI call it over HTTP.

**In this repo:**

- Manage config: optional `PYTHON_FUNCTION_URL`
- UI route: `/consultee-areas-python` (GET form + POST run)
- Python app: `apps/function-python` querying `consultee_area` via pymssql

**Fallback rule:** Missing Python environment, misconfigured URL, or stopped database must **not** take down the manage app. The bridge page shows an error message; other routes continue.

See [Node–Python integration](./node-python-integration.md).

## Track C — Optional SQL spatial database

**Intent:** Persist geometries (for example `case_boundary`, `consultee_area`) with SQL Server spatial types for spike / future journeys.

**In this repo:**

- Local Docker SQL Server (host port **1434**) via `docker compose`
- Prisma + raw geospatial helpers under `packages/database/src/geospatial`
- Home page may call `db.caseBoundary.count()` and fall back to dummy size if empty or unreachable
- `/items` pings the DB with `SELECT 1` as a connectivity smoke page

Track C is **optional** for most UI work: `npm start` brings the DB up for a full local stack, but UI prototype journeys should still degrade if SQL is unavailable where designed to do so.

## How the tracks interact

```
Browser
  └─ Azure Front Door (deployed) / localhost (local)
       └─ apps/manage (Track A UI)
            ├─ fixtures (dummy geometries, sample GeoJSON)
            ├─ optional: packages/database (Track C)
            └─ optional HTTP: PYTHON_FUNCTION_URL → apps/function-python (Track B)
                                    └─ optional: same SQL (Track C)
```

## Prototype vs optional geometry-database journeys

| Journey                      | Track   | Data source today                |
| ---------------------------- | ------- | -------------------------------- |
| Home search / select project | A       | Sample fixtures                  |
| Consultees results + maps    | A       | Sample GeoJSON + dummy metadata  |
| Map layers demo              | A       | Demo GeoJSON                     |
| Consultee areas (Python)     | B (+ C) | Python function → SQL            |
| Items list                   | C smoke | DB ping + placeholder tasks      |
| Upload / screening wizard    | —       | Not implemented in manage UI yet |

## Related pages

- [Routes and user journeys](./routes-and-user-journeys.md)
- [Search and filtering](./search-and-filtering.md)
- [Deployment and environments](./deployment-and-environments.md)
