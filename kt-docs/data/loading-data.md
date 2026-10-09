# Loading data

**Status:** Current — how to load data today, for screening and testing.

> **Being redeveloped:** data processing (ingest, ids and schema) is being rebuilt separately. This page only covers getting today's data in so the screening can run.

## Three ways to load

| Route                         | Use it for                                  | How                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Admin pages in the manage app | Loading full data into an Azure environment | 1. `/admin/upload-to-blob` — upload the GeoJSON file to the environment's blob container. 2. `/admin/import-reference-data` — replace a table with a known blob. Both run as the app's managed identity                                                                                                |
| DB Seed pipeline              | Seeding an Azure environment                | Run with `environment` and `loadFullReferenceData`. `false` loads the small sample from the repo; `true` imports `combined_reference_data_v1.geojson` and `all-project-boundaries.geojson` from blob storage (Dev/Test/Training only). Add `replaceExistingData` to clear each table first (see below) |
| `db-import` CLI               | Local development                           | `npm run db-import -- --type=consultee-areas --file=<path>` (or `--type=case-boundaries`); optional `--batch-size=<n>`                                                                                                                                                                                 |

> **Permissions:** the blob container is private and accepts Entra identities only. The app's identity can read and write it, so the admin pages work. The DB Seed pipeline's identity has no data-plane role on the container, so its full-data import fails with `AuthorizationPermissionMismatch` (403). Terraform can't grant it one: the pipeline identity may only create role assignments that pass an ABAC condition, and a role for itself doesn't (Infrastructure CD failed on exactly that). Until the platform team grants it Storage Blob Data Reader on the container, use the admin pages.

## What an import does

`loadConsulteeAreas` and `loadCaseBoundaries` (in `packages/database/src/geospatial/`) do the same steps:

1. **Read** the GeoJSON. The importer accepts both the small sample's camelCase properties and the real export's snake_case ones.
2. **Derive a stable id** for each row from its source id (or case reference + file name), so re-importing updates rows in place.
3. **Convert to WKT**, correcting ring winding.
4. **Upsert in batches** of 200 rows per round trip: one `MERGE` statement per batch, with rows passed as JSON through `OPENJSON`. That's the difference between seconds and tens of minutes for the full dataset.
5. **Validate and simplify** in SQL: `MakeValid()` on every geometry, and, for consultee areas, `geometrySimplified = Reduce(10).MakeValid()`.

Imports are safe to re-run: matching ids are updated in place and `lastUpdated` is refreshed.

### Merge or replace

By default an import **merges**: it never deletes. Rows whose ids aren't in the new file stay, so a source whose ids changed, or that dropped areas, leaves stale or duplicate consultees behind.

To **replace** a dataset instead, run the DB Seed pipeline with `replaceExistingData=true` (or `npm run db-import-from-blob -- ... --replace`). Each table is cleared in batches of 500 before loading, but only once its file has downloaded and parsed with at least one feature, so a missing blob or a bad file leaves the data as it was. The clear and the load aren't one transaction: if the load itself fails partway, the table is left partly loaded. Re-run the import to finish. The admin import page always replaces, with the same safeguards. It also shows the rows currently loaded: a full import can outlast Front Door's response timeout, in which case the browser shows an error while the import carries on, so reload the page and check the counts rather than submitting again.

## Timings

Backfilling `geometrySimplified` for all 18,258 rows (the migration) took 11s locally. A full import hasn't been timed on an Azure tier yet; expect any of them to be slower than a developer laptop, especially Basic and S0.

## Related pages

- [Data architecture overview](./data-architecture-overview.md)
- [Screening issues and open questions](./screening-issues-and-open-questions.md)
- [Upload and spatial screening](../upload-and-spatial-screening.md) (frontend pack)
