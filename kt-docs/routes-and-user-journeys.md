# Routes and user journeys

**Status:** Current for registered routes; Partial for product names that still use older spike vocabulary (`/filter`, uploads).

## Route map (manage app)

Registered primarily from `apps/manage/src/app/router.ts`.

| Method / path                                        | Journey                                                            | Prototype or optional DB?          | Data                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------- | -------------------------------------------------- |
| `GET /`                                              | Homepage: ruleset, search, paginated project list, select geometry | **Prototype**                      | Sample fixtures (+ optional `case_boundary` count) |
| `GET /consultees?geometryId=…`                       | Redirect into results                                              | Prototype                          | Query → `/consultees/:id`                          |
| `GET /consultees/:geometryId`                        | Case / screening-style results with maps                           | Prototype                          | Dummy geometry + sample GeoJSON                    |
| `GET /consultees/:id/sections/:sectionId/static-map` | Static map image (PNG path)                                        | Prototype                          | Server-rendered from sample geometry               |
| `GET /…/static-map.svg`                              | SVG static map variant                                             | Prototype                          | Same                                               |
| `GET /map-layers-demo`                               | Layer toggles experiment                                           | Prototype                          | Demo GeoJSON                                       |
| `GET                                                 | POST /consultee-areas-python`                                      | Call Python function and show rows | **Optional** Track B/C                             | Python → SQL |
| `GET /items`                                         | Placeholder list + DB ping                                         | Optional connectivity              | SQL `SELECT 1`                                     |
| `GET /signed-out`, `/unauthenticated`, `/error/…`    | Auth / error chrome                                                | Platform                           | —                                                  |
| `/auth/*`                                            | Entra sign-in / out (when auth enabled)                            | Platform                           | MSAL                                               |
| Monitoring routes from `@planning-inspectorate/core` | Health / monitoring                                                | Platform                           | —                                                  |

## Primary user journey (sample-data)

1. Open `/`
2. Choose a **ruleset**
3. Optionally search by case reference or project name (`q`)
4. Adjust **results per page** (`pageSize`: 25 / 50 / 100)
5. Select a project radio and continue to `/consultees`
6. Land on `/consultees/:geometryId` with optional `?ruleset=`
7. Review section headings, consultee lists, and interactive or static maps

This is the journey KT readers should treat as the “filter journey” even though paths are not named `/filter`.

## Interactive / static maps on results

On `/consultees/:geometryId`, each section can show:

- Defra Interactive Map when JavaScript initialises successfully
- Static map `<img>` via `<noscript>` and/or JS failure fallback using `data-static-map-src`

Details: [Maps](./maps.md).

## Uploads and screening results

> **Sparse:** There is no first-class upload wizard route in `apps/manage` yet. Comments and helpers (for example `geometry-bounds.ts`) anticipate an uploads-style map. External shapefile packaging remains documented in `docs/gis-shapefile-upload-and-report.md`.

Screening-**style** results on `/consultees/:id` are fixture-built sections (ambulance trusts, police, fire) — not live rule-engine output.

## Prototypes versus geometry-database journeys

| Kind                      | Examples                                   | Expectation                                           |
| ------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| Prototype / sample-backed | `/`, `/consultees/:id`, `/map-layers-demo` | Safe default for UX work; no CBOS                     |
| Optional bridge           | `/consultee-areas-python`                  | Needs Python function (+ usually SQL)                 |
| Optional DB smoke         | `/items`, home total count                 | Degrade or show errors without breaking the whole app |

## Auth impact on journeys

- Local default: `AUTH_DISABLED=true` — routes after monitoring are reachable without Entra
- With auth enabled: `/auth` is rate-limited; subsequent routes require login + group membership

## Related pages

- [Search and filtering](./search-and-filtering.md)
- [Case and dataset pages](./case-and-dataset-pages.md)
- [Upload and spatial screening](./upload-and-spatial-screening.md)
