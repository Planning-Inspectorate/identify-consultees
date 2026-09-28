# Search and filtering

**Status:** Partial — behaviour is implemented on `/`, not on `/filter` … `/filter-4`.

## Vocabulary mapping

Earlier spike / CBOS notes may say “filter journey” or `/filter` through `/filter-4`.

**In this repository today:**

| Conceptual step               | Actual route / UI                               |
| ----------------------------- | ----------------------------------------------- |
| Start filter / choose ruleset | `GET /` — ruleset `<select>`                    |
| Keyword search                | `GET /?q=…`                                     |
| Pagination size               | `GET /?pageSize=25\|50\|100`                    |
| Pick a case / geometry        | Radio table on `/`, submit to `GET /consultees` |
| Results                       | `GET /consultees/:geometryId?ruleset=…`         |

If you add real `/filter-n` routes later, update this page and [Routes and user journeys](./routes-and-user-journeys.md) in the same change.

## Query parameters (homepage)

| Param      | Purpose                               | Notes                                    |
| ---------- | ------------------------------------- | ---------------------------------------- |
| `ruleset`  | Selected screening ruleset value      | From `RULESETS` fixture list             |
| `q`        | Case reference or project name search | Case-insensitive substring over fixtures |
| `pageSize` | Rows to show                          | Allowed: 25, 50, 100 (default 25)        |

Selection continues with:

| Param        | Purpose                                                      |
| ------------ | ------------------------------------------------------------ |
| `geometryId` | Fixture id (for example `geo-1`) posted/get to `/consultees` |
| `ruleset`    | Carried through to results                                   |

## Pagination behaviour

- Homepage slices the **filtered fixture list** client-side in the controller (`slice(0, pageSize)`)
- “Showing X to Y of Z” uses `resultsTotal`
- With an empty search string, `resultsTotal` prefers `caseBoundary.count()` when greater than 0, else fixture length
- With a non-empty search, total is the filtered fixture length

> Reminder: **rows are still fixtures**. A non-zero SQL count only adjusts the summary total when not searching.

## Facets

**Sparse:** There is no multi-facet facet panel (stage, sector, nation, etc.) beyond ruleset + keyword today. Product may add facets later; keep them sample-data-backed until Track C ownership is explicit.

## Fixture ownership

| Concern                       | Owner module                                   |
| ----------------------------- | ---------------------------------------------- |
| Project rows + helper finders | `apps/manage/src/app/data/dummy-geometries.ts` |
| Ruleset labels/values         | Same module (`RULESETS`)                       |
| Map polygons for results      | `apps/manage/src/app/maps/sample-geojson.ts`   |

When changing fixture shape, update:

1. Homepage view-model types
2. Consultees results controller assumptions
3. Unit tests under `home/` and `dummy-geometries`
4. Playwright journeys that deep-link to `geo-1` (or whichever ids you keep)

## Related pages

- [Case and dataset pages](./case-and-dataset-pages.md)
- [Architecture and tracks](./architecture-and-tracks.md)
