# Upload and spatial screening

**Status:** Planned / sparse in the manage frontend — keep this page so Confluence has a stub.

## What exists today

| Piece                                                     | State                                                                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| In-app upload wizard (file → validate → screen → results) | **Not implemented** as manage routes                                                                  |
| Fixture “screening results” UI                            | **Yes** — `/consultees/:id` sections simulate outcomes                                                |
| External shapefile packaging / Astun GIS report process   | Documented in `docs/gis-shapefile-upload-and-report.md`                                               |
| Helpers anticipating uploads maps                         | `geometry-bounds.ts` (fit viewport from GeoJSON)                                                      |
| Python directories for write / intersect / orchestrate    | Referenced as future mirrors of PINS-data-spike in `apps/function-python/README.md` — not all present |

## Intended journey (target sketch)

Use this as the KT narrative until routes land:

1. **Upload** geometry (shapefile / GeoJSON — format TBD)
2. **Best-effort load** into optional spatial DB (Track C) or working store
3. **Choose ruleset** (align with homepage `RULESETS` vocabulary where possible)
4. **Run screening** (likely Track B Python / rule engine)
5. **Present results** with maps using the same interactive + static pattern as consultees results

## When the optional database is unavailable

Agreed direction for the spike (mirror existing Python page behaviour):

- Manage app **keeps serving** prototype journeys
- Upload / DB-backed screening should show a clear, non-fatal error state
- Do not block homepage fixture search on SQL health
- Logging should explain the failure without dumping secrets or full connection strings

## Results presentation (current stand-in)

Until real screening exists, treat `/consultees/:geometryId` as the **UX reference** for:

- Grouping consultees by theme / distance band
- Pairing lists with maps
- Carrying `ruleset` in the query string for labelling

## Related pages

- [Node–Python integration](./node-python-integration.md)
- [Case and dataset pages](./case-and-dataset-pages.md)
- External process: [`docs/gis-shapefile-upload-and-report.md`](../docs/gis-shapefile-upload-and-report.md)
