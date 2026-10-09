# Data model and loading

Two spatial datasets drive the service: **consultee areas** (what each potential consultee covers) and **case boundaries** (project sites). Both arrive as GeoJSON, go into private blob storage, and are imported into Azure SQL as `geography`.

> **Being redeveloped:** ingest, ids and schema are being rebuilt separately. This page describes today's tables as screening uses them. For what any replacement must keep, see [what screening needs from the data](./screening-engine.md#what-screening-needs-from-the-data).

## Flow

| Step    | What happens                                                                                                      | Where                                                               |
| ------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Source  | `combined_reference_data_v1.geojson` (consultee areas), `all-project-boundaries.geojson` (case boundaries), WGS84 | Produced outside this repo                                          |
| Upload  | Into the environment's blob container                                                                             | `/admin/upload-to-blob`                                             |
| Import  | Converted, validated, simplified, written in batches                                                              | `/admin/import-reference-data`, DB Seed pipeline or `db-import` CLI |
| Screen  | The ruleset's conditions run against `consultee_area` for one boundary                                            | Python function ([Screening engine](./screening-engine.md))         |
| Present | Lists with reasons, and maps                                                                                      | Web app                                                             |

| Store          | Holds                                              | Access                                                                                                |
| -------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Azure SQL      | `consultee_area`, `case_boundary`                  | Connection string from Key Vault; Prisma migrations run by Deploy                                     |
| Blob container | The source GeoJSON                                 | Private network, Entra only. The web and function apps' identities have Storage Blob Data Contributor |
| Repo sample    | `apps/function-python/setup_database/sample_data/` | `npm run db-seed`, tests, and DB Seed's default                                                       |
| Ruleset CSV    | `packages/database/src/geospatial/*_ruleset.csv`   | Read by the web app at start-up                                                                       |

| Environment    | SQL tier                       | Data                                           |
| -------------- | ------------------------------ | ---------------------------------------------- |
| Dev            | S2                             | Full reference dataset                         |
| Test, Training | Basic                          | Sample, unless the full data is loaded         |
| Prod           | S0, with a UK West geo-replica | Nothing yet: `seed-prod.ts` loads no demo data |

## Tables

Defined in `packages/database/src/schema.prisma`; spatial indexes, `CHECK` constraints and backfills are hand-written into the migrations (Prisma can't express them). Schema at `20261007090000_add_consultee_area_simplified_geometry`. There's no foreign key between the tables: screening relates them spatially.

**`consultee_area`**: one row per area a consultee covers, or a point for site-based consultees such as hospitals.

| Column                                                                           | Notes                                                                                                            |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `id`                                                                             | `UNIQUEIDENTIFIER`, derived from the source row's id                                                             |
| `geometry`                                                                       | `geography`, the original shape                                                                                  |
| `geometrySimplified`                                                             | `geometry.Reduce(10).MakeValid()`: every screening query runs on it, and the map draws a further-simplified copy |
| `geometryType`                                                                   | `CHECK`: Point, MultiPoint, LineString, MultiLineString, Polygon, MultiPolygon, GeometryCollection               |
| `consulteeCategory`                                                              | Indexed. What conditions match on, e.g. `Parish Council`. See [Reference data](./reference-data.md)              |
| `consultee`                                                                      | Display name                                                                                                     |
| `region`                                                                         | Being reworked separately                                                                                        |
| `metadata`, `lastUpdated`                                                        | Source attributes as JSON; refreshed on each import                                                              |
| `caseReference`, `documentId`, `consulteeId`, `organisationId`, `currentVersion` | Not populated today (`currentVersion` is always 1)                                                               |

**`case_boundary`**: one row per boundary **submission**. A case can have several, so `caseReference` isn't unique.

| Column                                  | Notes                                                               |
| --------------------------------------- | ------------------------------------------------------------------- |
| `id`                                    | `UNIQUEIDENTIFIER`, deterministic from case reference and file name |
| `geometry`, `geometryType`              | As above                                                            |
| `caseReference`, `caseName`             | e.g. `EN010102`, project name                                       |
| `fileName`, `receivedDate`              | Which submission                                                    |
| `acceptance`, `metadata`, `lastUpdated` | `acceptance` not populated                                          |

Spatial indexes (`GEOGRAPHY_AUTO_GRID`): `consultee_area_geometry_simplified_sidx` (every screening query, forced by hint), `consultee_area_geometry_sidx`, `case_boundary_geometry_sidx`. B-tree indexes on `consulteeCategory` and `caseReference`.

## Spatial conventions

- WGS84, SRID 4326, `geography` (round earth): `STDistance` is metres. GeoJSON order `[longitude, latitude]`.
- SQL Server needs exterior rings anticlockwise and holes clockwise, and may read a backwards ring as "the globe except this shape". `geospatial/wkt.ts` fixes winding on the way in; never skip it for a new source.
- `MakeValid()` on every geometry on import.
- Geometry is `Unsupported("geography")` in Prisma, so it's read and written with raw SQL as WKT (`STGeomFromText`, `STAsText`), passed as parameters, never concatenated.

## Loading

| Route            | For                                  | How                                                                                                                                |
| ---------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Admin pages      | An Azure environment                 | `/admin/upload-to-blob`, then `/admin/import-reference-data`. Always **replaces** the table. Shows current row counts              |
| DB Seed pipeline | An Azure environment                 | `loadFullReferenceData=false` loads the sample; `true` imports the two blobs (not Prod). Add `replaceExistingData=true` to replace |
| CLI              | Local, or any database you can reach | `npm run db-import -- --type=consultee-areas --file=<path>` (or `case-boundaries`; `--batch-size=<n>`)                             |

**Permissions:** the DB Seed pipeline's identity has no data-plane role on the container, so its full-data import fails with 403. Terraform can't grant one (an ABAC condition on the pipeline identity refuses it). Until the platform team grants Storage Blob Data Reader, use the admin pages.

An import (`loadConsulteeAreas`, `loadCaseBoundaries` in `packages/database/src/geospatial/`):

1. Reads the GeoJSON (camelCase sample or snake_case export properties).
2. Derives a stable id per row, so re-importing updates in place.
3. Converts to WKT, fixing winding.
4. Upserts 200 rows per round trip: one `MERGE` per batch, rows as JSON through `OPENJSON`. Seconds instead of tens of minutes.
5. Runs `MakeValid()` and, for consultee areas, builds `geometrySimplified`.

**Merge or replace.** A merge never deletes, so a source whose ids changed or that dropped areas leaves stale or duplicate consultees. Replace clears each table in batches of 500 first, but only once its file has downloaded and parsed with at least one feature, so a missing or bad file leaves the data as it was. Clear and load aren't one transaction: if the load fails partway, re-run it. A full import can outlast Front Door's timeout: the browser shows an error while the import carries on, so reload the admin page and check the counts rather than submitting again.

## Changing the schema

1. Edit `schema.prisma`, then run `npx prisma migrate dev --create-only` in `packages/database`.
2. Hand-add what Prisma can't express: spatial indexes, `CHECK` constraints, backfills. A new column can't be referenced in the batch that adds it, so wrap later statements in `EXEC('...')` (see the simplified-geometry migration).
3. Deploy runs `prisma migrate deploy`, including any backfill, so time it against the full dataset first (the simplified-geometry backfill took 11s locally for 18,258 rows).

Keep `SIMPLIFY_TOLERANCE_METRES` equal in `geospatial/consultee-areas.ts`, the migration and `apps/function-python/intersector/tolerances.py`.
