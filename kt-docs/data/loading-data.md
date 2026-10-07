# Loading data

**Status:** Current — how to load data today, for screening and testing.

> **Being redeveloped:** data processing (ingest, ids and schema) is being rebuilt separately. This page only covers getting today's data in so the screening can run.

## Three ways to load

| Route                         | Use it for                                  | How                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin pages in the manage app | Loading full data into an Azure environment | 1. `/admin/upload-to-blob` — upload the GeoJSON file to the environment's blob container. 2. `/admin/import-reference-data` — import a known blob into SQL. Both run as the app's managed identity                                    |
| DB Seed pipeline              | Seeding an Azure environment                | Run with `environment` and `loadFullReferenceData`. `false` loads the small sample from the repo; `true` imports `combined_reference_data_v1.geojson` and `all-project-boundaries.geojson` from blob storage (Dev/Test/Training only) |
| `db-import` CLI               | Local development                           | `npm run db-import -- --type=consultee-areas --file=<path>` (or `--type=case-boundaries`); optional `--batch-size=<n>`                                                                                                                |

> **Permissions gotcha:** the blob container is private and accepts managed identities only. The apps' identities can read and write it. When this was set up, the DB Seed pipeline's own identity had no access and failed with `AuthorizationPermissionMismatch` (403) — which is why the admin import page exists. Check the pipeline identity's access before relying on the pipeline route.

## What an import does

`loadConsulteeAreas` and `loadCaseBoundaries` (in `packages/database/src/geospatial/`) do the same steps:

1. **Read** the GeoJSON. The importer accepts both the small sample's camelCase properties and the real export's snake_case ones.
2. **Derive a stable id** for each row from its source id (or case reference + file name), so re-importing updates rows in place.
3. **Convert to WKT**, correcting ring winding.
4. **Upsert in batches** of 200 rows per round trip: one `MERGE` statement per batch, with rows passed as JSON through `OPENJSON`. That's the difference between seconds and tens of minutes for the full dataset.
5. **Validate and simplify** in SQL: `MakeValid()` on every geometry, and, for consultee areas, `geometrySimplified = Reduce(10).MakeValid()`.

Imports are safe to re-run: matching ids are updated in place and `lastUpdated` is refreshed.

## Timings

Backfilling `geometrySimplified` for all 18,258 rows (the migration) took 11s locally. A full import hasn't been timed on an Azure tier yet; expect any of them to be slower than a developer laptop, especially Basic and S0.

## Related pages

- [Data architecture overview](./data-architecture-overview.md)
- [Screening issues and open questions](./screening-issues-and-open-questions.md)
- [Upload and spatial screening](../upload-and-spatial-screening.md) (frontend pack)
