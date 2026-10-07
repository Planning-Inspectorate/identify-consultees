# Routes and user journeys

**Status:** Current for registered routes; Partial for product names that still use older spike vocabulary (`/filter`, uploads).

## Route map (manage app)

Registered primarily from `apps/manage/src/app/router.ts`.

| Method / path                                                                                    | Journey                                                         | Data                                                  |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------- |
| `GET /`                                                                                          | Homepage: DB-backed search + paginated project list             | `case_boundary` via `searchCaseBoundaries`            |
| `GET /consultees/:caseId?ruleset=…`                                                              | Project map page: shapefile/ruleset rows + map + report link    | `runRuleset` spatial queries                          |
| `GET /consultees/:caseId/ruleset` · `POST /consultees/:caseId/ruleset`                           | Change-ruleset radios; posts back and returns to the map        | Case summary + `RULESETS`                             |
| `GET /consultees/:caseId/shapefile` · `POST /consultees/:caseId/shapefile`                       | Change-shapefile radios; lands on the chosen boundary's map     | `listCaseBoundaryFiles`                               |
| `GET /consultees/:caseId/report?ruleset=…&exclude=…`                                             | Check page: report details + per-category consultee counts      | `runRuleset` match counts                             |
| `GET /consultees/:caseId/report/consultees?ruleset=…&category=…&exclude=…`                       | Shared per-category Change page: map + removable consultee rows | `runRuleset` spatial queries                          |
| `GET /consultees/:caseId/report/created?ruleset=…`                                               | Report created confirmation + download link (placeholder)       | Case summary                                          |
| `GET /consultees/:caseId/results?ruleset=…`                                                      | Consultee tables (the future report) for the selection          | `runRuleset` spatial queries                          |
| `GET /consultees/:caseId/results/static-map`                                                     | Static map image — AVIF/WebP/PNG negotiated from `Accept`       | Same, server-rendered; `category`/`exclude` filter it |
| `GET /consultees/:caseId/results/static-map.svg`                                                 | Explicit SVG static map variant                                 | Same                                                  |
| `GET /map-layers-demo`                                                                           | Layer toggles experiment                                        | Demo GeoJSON                                          |
| `GET /components` · `GET /components/:component`                                                 | Component showcase index + GOV.UK macro detail pages            | Static examples                                       |
| `GET /components/interactive-map` · `/:example`                                                  | Worked Defra Interactive Map examples                           | Sample GeoJSON                                        |
| `GET /components/interactive-map/:example/static-map(.svg)`                                      | Static fallback for each example                                | Same                                                  |
| `GET /consultee-areas-python` · `POST /consultee-areas-python/run`                               | Call the Python function and show rows                          | Python → SQL (`x-api-key`)                            |
| `GET /consultee-areas-direct` · `POST /consultee-areas-direct/run`                               | Same query straight from Node                                   | SQL `consultee_area`                                  |
| `GET /admin/upload-to-blob` · `POST /admin/upload-to-blob/run`                                   | Upload a file to the app's blob container                       | Managed identity → blob storage                       |
| `GET /admin/import-reference-data` · `POST …/run-consultee-areas` · `POST …/run-case-boundaries` | Import the known reference-data blobs into SQL                  | Blob → `geojson-import`                               |
| `GET /items`                                                                                     | Placeholder list + DB ping                                      | SQL `SELECT 1`                                        |
| `/vendor/*`                                                                                      | Defra map plugin bundles (rate-limited, lazy Brotli)            | `src/.static/vendor`                                  |
| `GET /signed-out`, `/unauthenticated`, `/error/…`                                                | Auth / error chrome                                             | —                                                     |
| `/auth/*`                                                                                        | Entra sign-in / out (when auth enabled)                         | MSAL                                                  |
| Monitoring routes from `@planning-inspectorate/core`                                             | Health / monitoring                                             | —                                                     |

## Primary user journey

1. Open `/`
2. Optionally search by case reference or project name (`q`)
3. Adjust **results per page** (`pageSize`: 25 / 50 / 100)
4. Follow a project link to `/consultees/:caseId` — the map page, which runs the default ruleset
5. Optionally **Change** the shapefile (`:caseId/shapefile`) or ruleset (`:caseId/ruleset`); each posts back and returns to the map page with the new selection in its URL
6. _Preview report_ leads to `/consultees/:caseId/report?ruleset=…` — a check page listing the report details and per-category match counts. The full consultee tables for the selection live on `/consultees/:caseId/results?ruleset=…`
7. Each category's **Change** link opens the shared page at `/consultees/:caseId/report/consultees?ruleset=…&category=…` — the map plus that category's rows, each with a _Remove_ link. Removals are carried as repeated `exclude=<consulteeAreaId>` query params (no server-side state), so the check page's counts and the category page's rows always agree. _Save and return_ goes back to the check page; the excluded ids also follow the _Generate report_ link to `/report/created`

This is the journey KT readers should treat as the “filter journey” even though paths are not named `/filter`.

## Interactive / static maps on results

On `/consultees/:caseId` (and the `/results` report), the map shows the project boundary plus matched consultee areas:

- Defra Interactive Map when JavaScript initialises successfully
- Static map `<img>` via `<noscript>` and/or JS failure fallback (`data-static-map-src` / page config)

Details: [Maps](./maps.md).

## Uploads and screening results

There is no end-user upload wizard route in `apps/manage` yet. What exists:

- **Admin data loading**: `/admin/upload-to-blob` (file → app's blob container) and `/admin/import-reference-data` (known blobs → `consultee_area` / `case_boundary`). These back the DB Seed pipeline's `loadFullReferenceData` flow.
- **In-app screening**: `runRuleset` (`packages/database/src/geospatial/rulesets.ts`) runs the chosen ruleset's conditions as real spatial queries on the results page.
- External shapefile packaging remains documented in `docs/gis-shapefile-upload-and-report.md`.

## Journeys by dependency

| Kind                   | Examples                                                         | Expectation                                                  |
| ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| DB-backed main journey | `/`, `/consultees/:caseId`, `/consultees/:caseId/results`        | Needs SQL + seed/reference data; degrades with logged errors |
| Showcase / demo        | `/components`, `/components/interactive-map`, `/map-layers-demo` | Work without SQL                                             |
| Optional bridge        | `/consultee-areas-python`                                        | Needs Python function (+ SQL)                                |
| Optional DB pages      | `/consultee-areas-direct`, `/items`, `/admin/*`                  | Need SQL (admin import also needs blob config)               |

## Auth impact on journeys

- Local default: `AUTH_DISABLED=true` — routes after monitoring are reachable without Entra
- With auth enabled: `/auth` is rate-limited; subsequent routes require login + group membership

## Related pages

- [Search and filtering](./search-and-filtering.md)
- [Case and dataset pages](./case-and-dataset-pages.md)
- [Upload and spatial screening](./upload-and-spatial-screening.md)
