# Data architecture overview

**Status:** Current — reflects `main` as of October 2026.

## In one paragraph

Two spatial datasets drive the service: **consultee areas** (the areas each potential consultee covers — councils, parishes, hospitals, national parks and so on) and **case boundaries** (the site boundaries of planning cases). Both arrive as GeoJSON files, are uploaded to private blob storage, and are imported into an Azure SQL database as `geography` columns. When a user runs a ruleset for a case, the manage app screens that case's boundary against the consultee areas with spatial SQL queries and lists the consultees to contact, with a map.

## Data flow

> **Being redeveloped:** steps 1–4 (ingest, ids and schema) are being rebuilt separately. Steps 5–6, the screening, are what this pack focuses on.

| Step            | What happens                                                                                                                           | Where                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1. Source files | GeoJSON (WGS84 / CRS84): `combined_reference_data_v1.geojson` (consultee areas) and `all-project-boundaries.geojson` (case boundaries) | Produced outside this repo                                                                                                      |
| 2. Upload       | Files are put in the environment's blob container                                                                                      | Admin page `/admin/upload-to-blob`, using the app's managed identity                                                            |
| 3. Import       | GeoJSON is converted and upserted into SQL in batches; each geometry is validated and a simplified copy made                           | Admin page `/admin/import-reference-data`, the DB Seed pipeline, or the `db-import` CLI — see [Loading data](./loading-data.md) |
| 4. Store        | `consultee_area` and `case_boundary` tables, with spatial indexes                                                                      | Azure SQL Database                                                                                                              |
| 5. Screen       | A ruleset's conditions run as spatial queries against `consultee_area` for one case boundary                                           | `runRuleset` in `packages/database/src/geospatial/rulesets.ts`, called by `/consultees/:caseId/results`                         |
| 6. Present      | Matches are shown in tables and on a map (original geometry); a static map image serves no-JavaScript users                            | Manage app                                                                                                                      |

## Stores

| Store                  | Holds                                                                                                                             | Access                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Azure SQL Database     | `consultee_area`, `case_boundary` (plus Prisma's `_prisma_migrations`)                                                            | App via connection string from Key Vault; schema changes by Prisma migrations run in the Deploy pipeline                 |
| Blob storage container | The source GeoJSON files                                                                                                          | Private network only, no shared keys; the web and function apps' managed identities have _Storage Blob Data Contributor_ |
| Repo sample data       | `apps/function-python/setup_database/sample_data/` — a small `reference_data.geojson` and `sample_application_boundaries.geojson` | Seeded into Dev/Test/Training by the DB Seed pipeline when the full data isn't requested; used by tests                  |
| Ruleset definition     | `packages/database/src/geospatial/example_ruleset.csv`                                                                            | Read into memory when the app starts                                                                                     |

## Readers and writers

| Component                                | Reads                                                     | Writes                                 |
| ---------------------------------------- | --------------------------------------------------------- | -------------------------------------- |
| Manage app (Node)                        | Both tables — search, case pages, ruleset screening, maps | Both tables, via the admin import page |
| DB Seed pipeline                         | Blob container (full data option)                         | Both tables                            |
| `db-import` CLI                          | A local GeoJSON file                                      | Both tables                            |
| Python function (`/api/consultee-areas`) | `consultee_area` (a simple listing)                       | Nothing                                |

## Environments

| Environment | SQL tier      | Geo-replica                  | Data loaded                                                         |
| ----------- | ------------- | ---------------------------- | ------------------------------------------------------------------- |
| Dev         | S2 (50 DTU)   | No                           | Full reference dataset                                              |
| Test        | Basic (5 DTU) | No                           | Sample, unless the full data is loaded                              |
| Training    | Basic (5 DTU) | No                           | Sample, unless the full data is loaded                              |
| Prod        | S0 (10 DTU)   | Yes (UK West failover group) | Nothing seeded yet — `seed-prod.ts` deliberately loads no demo data |

> **Watch out:** Basic and S0 are much smaller than Dev's S2, and screening is CPU-heavy. Dev struggled badly on Basic before it was upgraded. See [Screening issues and open questions](./screening-issues-and-open-questions.md).

## Related pages

- [Data model](./data-model.md)
- [Loading data](./loading-data.md)
- [Deployment and environments](../deployment-and-environments.md) (frontend pack)
