# Case and dataset pages

**Status:** Current for the case journey; sparse for a separate dataset catalogue.

## Case reference routing

A "case" is a `case_boundary` row — one uploaded boundary for an NSIP project, identified by a UNIQUEIDENTIFIER. Users pick one from the homepage list, which links straight to:

```
/consultees/:caseId            # choose a ruleset
/consultees/:caseId/results?ruleset=<id>   # run it and see matched consultees
```

`caseId` must be a UUID — `resolveCase` (`apps/manage/src/app/views/consultees/resolve-case.ts`) returns 404 for anything else without touching the database. Note a `caseReference` (e.g. `EN010025`) is **not** unique — a project can have several boundary submissions — so pages always deep-link by id, not reference.

E2e fixtures use `SAMPLE_CASE_ID` / `SAMPLE_RULESET_ID` from `e2e/fixtures.ts`, derived from the dev seed data.

## What the results page shows

Controller: `apps/manage/src/app/views/consultees/results/controller.ts`

Typical content:

- Page heading with the case name and reference
- The ruleset used (`Ruleset used: <name>`)
- One map region (interactive + static fallback) showing the project boundary and the matched consultee areas, filled by category — see [Maps](./maps.md#results-map-layers)
- A GOV.UK table of matches: consultee, category, region. Distances aren't shown

Matches are real spatial query output: the Python function (`run_ruleset`, via `service.rulesetRunner`) runs every condition in the ruleset (`intersection` within a buffer, or `bordering` a host area) and returns the de-duplicated union, nearest first. This is the actual screening engine, not a stand-in — though only one ruleset (`example-ruleset`, built from `england_wales_post_20240430_ruleset.csv`) exists so far.

## Which database rows are reachable

| Kind           | Table            | Reached via                                                        |
| -------------- | ---------------- | ------------------------------------------------------------------ |
| Case boundary  | `case_boundary`  | Homepage search → `/consultees/:caseId` journey                    |
| Consultee area | `consultee_area` | Ruleset matches on results; `/consultee-areas-direct`; Python page |

Rows land in these tables via `npm run db-seed` (bundled sample), `npm run db-import` / `db-import-from-blob`, the DB Seed pipeline's `loadFullReferenceData` option, or `/admin/import-reference-data`. Anything not loaded simply never matches — there is no fixture layer to fall back to.

## Dataset overview content

**Sparse:** There is no separate "dataset catalogue" page yet. Closest surfaces:

- Homepage project table (the `case_boundary` catalogue)
- `/consultee-areas-python` / `/consultee-areas-direct` (raw-ish `consultee_area` rows)
- `/map-layers-demo` (overlay experimentation)

## Related pages

- [Search and filtering](./search-and-filtering.md)
- [Maps](./maps.md)
- [Upload and spatial screening](./upload-and-spatial-screening.md)
