# Search and filtering

**Status:** Current — behaviour is implemented on `/` against `case_boundary`, not on `/filter` … `/filter-4`.

## Vocabulary mapping

Earlier spike / CBOS notes may say “filter journey” or `/filter` through `/filter-4`.

**In this repository today:**

| Conceptual step        | Actual route / UI                              |
| ---------------------- | ---------------------------------------------- |
| Start / find a project | `GET /` — project list                         |
| Keyword search         | `GET /?q=…`                                    |
| Pagination size        | `GET /?pageSize=25\|50\|100`                   |
| Pick a case            | Project link → `GET /consultees/:caseId`       |
| Choose ruleset         | `GET /consultees/:caseId` — ruleset `<select>` |
| Results                | `GET /consultees/:caseId/results?ruleset=…`    |

If you add real `/filter-n` routes later, update this page and [Routes and user journeys](./routes-and-user-journeys.md) in the same change.

## Query parameters

On the homepage:

| Param      | Purpose                               | Notes                                                                              |
| ---------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
| `q`        | Case reference or project name search | SQL `LIKE` over `case_boundary` (leading wildcard — fine while the table is small) |
| `pageSize` | Rows to show                          | Allowed: 25, 50, 100 (default 25)                                                  |

Continuing the journey:

| Param / segment | Purpose                                              |
| --------------- | ---------------------------------------------------- |
| `caseId`        | `case_boundary` row id (a UNIQUEIDENTIFIER)          |
| `ruleset`       | Ruleset id from `RULESETS` (`example-ruleset` today) |

## Search behaviour

- `searchCaseBoundaries` (`packages/database/src/geospatial/case-boundaries.ts`) runs the query in SQL: filtered rows plus `COUNT(*) OVER()` as the total, limited to `pageSize`
- “Showing X to Y of Z” comes from the real result count — no fixture fallback
- An unreachable database logs an error and renders an empty list rather than breaking the page
- The homepage also shows one random example case (`getRandomCaseSummary`) as a hint for what a reference looks like

## Pagination behaviour

- `pageSize` is a row limit passed to the SQL query, applied server-side in the controller
- Page navigation beyond page size (an offset/page-number param) is not built yet — the list shows the first `pageSize` matches

## Facets

**Sparse:** There is no multi-facet panel (stage, sector, nation, etc.) beyond keyword search today. Product may add facets later; the columns exist on `case_boundary` if they are needed.

## Data ownership

| Concern               | Owner module / path                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Project rows + search | `packages/database/src/geospatial/case-boundaries.ts`                                              |
| Ruleset definitions   | `packages/database/src/geospatial/rulesets.ts` + `example_ruleset.csv`                             |
| Results map config    | `apps/manage/src/app/maps/case-geojson.ts`                                                         |
| Seeded sample rows    | `packages/database/src/seed/data-dev.ts` (loads `apps/function-python/setup_database/sample_data`) |

When changing the case model or ruleset shape, update:

1. `home` and `consultees` view-model types
2. `resolveCase` assumptions (ids are UNIQUEIDENTIFIERs — non-UUID path segments 404 without a DB round trip)
3. Unit tests under `home/` and `consultees/`
4. Playwright fixtures — `e2e/fixtures.ts` keys off ids produced by the dev seed (`SAMPLE_CASE_ID`, `SAMPLE_RULESET_ID`)

## Related pages

- [Case and dataset pages](./case-and-dataset-pages.md)
- [Architecture and tracks](./architecture-and-tracks.md)
