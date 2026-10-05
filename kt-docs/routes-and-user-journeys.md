# Routes and user journeys

**Status:** Current for registered routes; Partial for product names that still use older spike vocabulary (`/filter`, uploads).

## Route map (manage app)

Registered primarily from `apps/manage/src/app/router.ts`.

| Method / path                                                                                    | Journey                                                      | Data                                       |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------ |
| `GET /`                                                                                          | Homepage: DB-backed search + paginated project list          | `case_boundary` via `searchCaseBoundaries` |
| `GET /consultees/:caseId`                                                                        | Ruleset picker for the chosen project                        | Case summary + `RULESETS`                  |
| `GET /consultees/:caseId/results?ruleset=…`                                                      | Runs the ruleset; matched consultees on a map and in a table | `runRuleset` spatial queries               |
| `GET /consultees/:caseId/results/static-map`                                                     | Static map image — AVIF/WebP/PNG negotiated from `Accept`    | Same, server-rendered                      |
| `GET /consultees/:caseId/results/static-map.svg`                                                 | Explicit SVG static map variant                              | Same                                       |
| `GET /map-layers-demo`                                                                           | Layer toggles experiment                                     | Demo GeoJSON                               |
| `GET /components` · `GET /components/:component`                                                 | Component showcase index + GOV.UK macro detail pages         | Static examples                            |
| `GET /components/interactive-map` · `/:example`                                                  | Worked Defra Interactive Map examples                        | Sample GeoJSON                             |
| `GET /components/interactive-map/:example/static-map(.svg)`                                      | Static fallback for each example                             | Same                                       |
| `GET /consultee-areas-python` · `POST /consultee-areas-python/run`                               | Call the Python function and show rows                       | Python → SQL (`x-api-key`)                 |
| `GET /consultee-areas-direct` · `POST /consultee-areas-direct/run`                               | Same query straight from Node                                | SQL `consultee_area`                       |
| `GET /admin/upload-to-blob` · `POST /admin/upload-to-blob/run`                                   | Upload a file to the app's blob container                    | Managed identity → blob storage            |
| `GET /admin/import-reference-data` · `POST …/run-consultee-areas` · `POST …/run-case-boundaries` | Import the known reference-data blobs into SQL               | Blob → `geojson-import`                    |
| `GET /items`                                                                                     | Placeholder list + DB ping                                   | SQL `SELECT 1`                             |
| `/vendor/*`                                                                                      | Defra map plugin bundles (rate-limited, lazy Brotli)         | `src/.static/vendor`                       |
| `GET /signed-out`, `/unauthenticated`, `/error/…`                                                | Auth / error chrome                                          | —                                          |
| `/auth/*`                                                                                        | Entra sign-in / out (when auth enabled)                      | MSAL                                       |
| Monitoring routes from `@planning-inspectorate/core`                                             | Health / monitoring                                          | —                                          |

## Primary user journey

1. Open `/`
2. Optionally search by case reference or project name (`q`)
3. Adjust **results per page** (`pageSize`: 25 / 50 / 100)
4. Follow a project link to `/consultees/:caseId`
5. Choose a **ruleset** and continue to `/consultees/:caseId/results?ruleset=…`
6. Review the matched consultees table and the interactive or static map

This is the journey KT readers should treat as the “filter journey” even though paths are not named `/filter`.

## Interactive / static maps on results

On `/consultees/:caseId/results`, the map shows the project boundary plus matched consultee areas:

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
