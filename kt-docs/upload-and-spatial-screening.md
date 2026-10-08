# Upload and spatial screening

**Status:** Partial — data loading and ruleset screening exist; there is still no end-user upload wizard.

## What exists today

| Piece                                                     | State                                                                                                                                                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-app upload wizard for users (file → validate → screen) | **Not implemented** as manage routes                                                                                                                                          |
| Admin upload to blob storage                              | **Yes** — `GET/POST /admin/upload-to-blob` (multer, managed identity, `BLOB_STORE_*` config)                                                                                  |
| Admin import of reference data into SQL                   | **Yes** — `GET/POST /admin/import-reference-data` for the two known blobs (consultee areas + case boundaries)                                                                 |
| Real ruleset screening                                    | **Yes** — `run_ruleset` in `apps/function-python/querying/rulesets.py` runs `STIntersects`/`STDistance`/bordering queries; `/consultees/:caseId/results` presents the matches |
| Pipeline equivalent                                       | DB Seed pipeline `loadFullReferenceData` option → `npm run import-from-blob`; CLI: `npm run db-import` for local files                                                        |
| External shapefile packaging / Astun GIS report process   | Documented in `docs/gis-shapefile-upload-and-report.md`                                                                                                                       |
| Helpers anticipating uploads maps                         | `geometry-bounds.ts` (fit viewport from GeoJSON)                                                                                                                              |
| Python directories for write / intersect / orchestrate    | Referenced as future mirrors of PINS-data-spike in `apps/function-python/README.md` — not all present                                                                         |

## Intended end-user journey (target sketch)

Use this as the KT narrative until routes land:

1. **Upload** geometry (shapefile / GeoJSON — format TBD)
2. **Best-effort load** into the spatial DB (probably reusing `geojson-import.ts`)
3. **Choose ruleset** (reuse `RULESETS` vocabulary from the picker page)
4. **Run screening** — the Python function's `run-ruleset` route already does this
5. **Present results** with the same interactive + static map pattern as `/consultees/:caseId/results`

## When the database is unavailable

Agreed direction (mirrors existing behaviour):

- Manage app **keeps serving** non-DB journeys (component showcase, map demos)
- DB-backed pages show a clear, non-fatal error state (`/consultee-areas-direct`, `/admin/*` already do)
- Logging should explain the failure without dumping secrets or full connection strings

## Results presentation

`/consultees/:caseId/results` is the reference implementation:

- Matched consultees in a GOV.UK table (consultee, category, region, distance)
- Project boundary + matches on one map (interactive, static fallback)
- `ruleset` carried in the query string for labelling and cache identity

## Related pages

- [Node–Python integration](./node-python-integration.md)
- [Case and dataset pages](./case-and-dataset-pages.md)
- External process: [`docs/gis-shapefile-upload-and-report.md`](../docs/gis-shapefile-upload-and-report.md)
