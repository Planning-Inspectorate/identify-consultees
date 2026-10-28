# Data model and loading

Two spatial datasets drive the service: **consultee areas** (what each potential consultee covers) and **case boundaries** (project sites). Both arrive as GeoJSON, go into private blob storage, and are imported into Azure SQL as `geography`.

> **Being redeveloped:** ingest, ids and schema are being rebuilt separately. This page describes today's tables as screening uses them. For what any replacement must keep, see [what screening needs from the data](./screening-engine.md#what-screening-needs-from-the-data).

## Flow

| Step    | What happens                                                                                                                      | Where                                                               |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Source  | A file per group of consultee areas (`20261020_public_bodies.geojson`), `all-project-boundaries.geojson` (case boundaries), WGS84 | The data processing pipeline (another repo)                         |
| Upload  | Into the environment's blob container                                                                                             | `/admin/upload-to-blob`                                             |
| Import  | Converted, validated, simplified, written in batches                                                                              | `/admin/import-reference-data`, DB Seed pipeline or `db-import` CLI |
| Screen  | The ruleset's conditions run against `consultee_area` for one boundary                                                            | Python function ([Screening engine](./screening-engine.md))         |
| Present | Lists with reasons, and maps                                                                                                      | Web app                                                             |

| Store          | Holds                                                                                                                     | Access                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Azure SQL      | `consultee_area_<quarter>` (one per quarter, `consultee_area` the dataset in use), `case_boundary`, `reference_data_load` | Connection string from Key Vault; Prisma migrations run by Deploy                                     |
| Blob container | The source GeoJSON                                                                                                        | Private network, Entra only. The web and function apps' identities have Storage Blob Data Contributor |
| Repo sample    | `apps/function-python/setup_database/sample_data/`                                                                        | `npm run db-seed`, tests, and DB Seed's default                                                       |
| Ruleset CSV    | `packages/database/src/geospatial/*_ruleset.csv`                                                                          | Read by the web app at start-up                                                                       |

| Environment    | SQL tier                       | Data                                           |
| -------------- | ------------------------------ | ---------------------------------------------- |
| Dev            | S2                             | Full reference dataset                         |
| Test, Training | Basic                          | Sample, unless the full data is loaded         |
| Prod           | S0, with a UK West geo-replica | Nothing yet: `seed-prod.ts` loads no demo data |

## Tables

Defined in `packages/database/src/schema.prisma`; spatial indexes, `CHECK` constraints and backfills are hand-written into the migrations (Prisma can't express them). Schema at `20261007090000_add_consultee_area_simplified_geometry`. There's no foreign key between the tables: screening relates them spatially.

**`consultee_area`** (each quarter's table, `consultee_area_2026Q4`, through the `consultee_area` synonym for the one in use - see [Loading](#loading)): one row per area a consultee covers, or a point for site-based consultees such as hospitals. Its columns follow the reference data export's own fields (`20261019170000_consultee_area_follows_export`).

| Column                                                    | Notes                                                                                                                                                                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                      | `UNIQUEIDENTIFIER`, derived from the export's id                                                                                                                                                                        |
| `sourceId`                                                | The export's own id, such as `health_AMB_EW_00001`                                                                                                                                                                      |
| `geometry`                                                | `geography`, the original shape                                                                                                                                                                                         |
| `geometrySimplified`                                      | `geometry.Reduce(10).MakeValid()`: every screening query runs on it, and the map draws a further-simplified copy                                                                                                        |
| `geometryType`                                            | `CHECK`: Point, MultiPoint, LineString, MultiLineString, Polygon, MultiPolygon, GeometryCollection                                                                                                                      |
| `consulteeCategory`                                       | Indexed. What conditions match on, e.g. `Parish Council`: the export's dataset mapped by `config/reference-data.yaml`. See [Reference data](./reference-data.md)                                                        |
| `consulteeGroup`                                          | The export's own `consultee_category`, a broad group: Health, Local Authorities, Transport...                                                                                                                           |
| `consulteeSubcategory`, `consulteeSubcategoryDescription` | The export's `consultee_subcategory` and what it means: a port's Statutory or NonStatutory, a railway's Active or Inactive, an interconnector's build status (Built, Proposed, Scoping). Null where the export has none |
| `currentVersion`, `validFrom`, `validTo`                  | The export's `current_version`, `valid_from` and `valid_to`: which version of the area this is (1 if not given), and the dates it applies from and until (null while current). Stored, not shown in the report          |
| `consultee`                                               | Display name                                                                                                                                                                                                            |
| `region`                                                  | The export's region                                                                                                                                                                                                     |
| `metadata`                                                | The export's metadata as JSON, as given: each source dataset's own attributes, starting with `CODE` and `NAME`. A `CHECK` (`ISJSON`) refuses anything else                                                              |
| `lastUpdated`                                             | When the row was loaded                                                                                                                                                                                                 |

**`case_boundary`**: one row per boundary **submission**. A case can have several, so `caseReference` isn't unique.

| Column                                  | Notes                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| `id`                                    | `UNIQUEIDENTIFIER`, deterministic from case reference and file name              |
| `geometry`, `geometryType`              | As above                                                                         |
| `geometrySimplified`                    | `geometry.Reduce(10).MakeValid()`: Nearby NSIPs are measured, and drawn, from it |
| `caseReference`, `caseName`             | e.g. `EN010102`, project name                                                    |
| `fileName`, `receivedDate`              | Which submission                                                                 |
| `acceptance`, `metadata`, `lastUpdated` | `acceptance`: the case's stage (Pre-Examination), from CBOS - the name is older  |

Spatial indexes (`GEOGRAPHY_AUTO_GRID`): `consultee_area_geometry_simplified_sidx` (every screening query, forced by hint), `consultee_area_geometry_sidx`, `case_boundary_geometry_sidx`. B-tree indexes on `consulteeCategory` and `caseReference`.

## Spatial conventions

- WGS84, SRID 4326, `geography` (round earth): `STDistance` is metres. GeoJSON order `[longitude, latitude]`.
- SQL Server needs exterior rings anticlockwise and holes clockwise, and may read a backwards ring as "the globe except this shape". `geospatial/wkt.ts` fixes winding on the way in; never skip it for a new source.
- `MakeValid()` on every geometry on import.
- Geometry is `Unsupported("geography")` in Prisma, so it's read and written with raw SQL as WKT (`STGeomFromText`, `STAsText`), passed as parameters, never concatenated.

## Loading

| Route            | For                                        | How                                                                                                                                                                                        |
| ---------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Admin pages      | An Azure environment                       | `/admin/upload-to-blob` (up to 1GB), then `/admin/import-reference-data`: consultee areas a group at a time (see below), case boundaries whole. Shows current row counts                   |
| DB Seed pipeline | An Azure environment                       | `loadFullReferenceData=false` loads the sample; `true` imports the two blobs (not Prod). Consultee areas always replace; add `replaceExistingData=true` to replace the case boundaries too |
| CLI              | Local, or any database you can reach       | `npm run db-import -- --type=consultee-areas --file=<path>` (or `case-boundaries`; `--batch-size=<n>`)                                                                                     |
| From CBOS        | Case boundaries, any connected environment | `/admin/import-from-cbos`. Merges; see below                                                                                                                                               |

**Consultee areas load a group at a time.** [`config/reference-data.yaml`](../../config/reference-data.yaml)'s `groups` puts every consultee category in one of five groups, the report's tabs: Administrative boundaries, Public bodies, Energy, Transport, Other. The pipeline writes a file per group, named for the date its data is from: `20261020_public_bodies.geojson`. On `/admin/upload-to-blob` each group has its own form; the date fills in from the chosen file's name and the file is saved under that name. On `/admin/import-reference-data` each group's **Load** takes its newest file and replaces that group's consultee areas, its categories' rows, leaving the other groups as they are (`seed/consultee-area-groups.ts`).

- **A table per quarter.** Each quarter's consultee areas are a dataset, a table named for the quarter: `consultee_area_2026Q4`. A group's file goes into its quarter's table, made the first time one of the quarter's groups is loaded (`dbo.create_consultee_area_dataset`), and replaces that group's rows there, so a corrected file can be loaded again. Earlier quarters' tables are kept as they are, as the archive.
- **The dataset in use.** `consultee_area` is a synonym for the dataset the tool uses: the newest quarter that has every group loaded. Everything that reads or writes consultee areas (screening, maps, report, admin pages, the CLI) goes through it. A newer quarter becomes the dataset in use once every group with data in the current one has rows in it (`dbo.use_consultee_area_dataset` switches the synonym). Until then the tool keeps using the one before, and the import page says which groups the new quarter is waiting for. Both procedures run with the owner's rights, so the app's database user needs none for DDL. The Python function can screen a named quarter's table instead (`dataset`, see [Screening service](../screening-service.md)); nothing in the web app asks for one yet.
- **The load log.** `reference_data_load` records each load: file, data date, quarter (its table) and rows loaded. The import page reads each group's last load into the dataset in use from it. A full import (CLI, DB Seed) replaces the dataset in use whole, and clears its quarter's log.
- **Refusals.** A file holding a category from another group, one from an earlier quarter than the dataset in use, an empty one or one not named for a group is refused before anything changes, and the page says why.
- **Clear consultee areas** empties the dataset you choose from a dropdown of the quarters that have one (the one in use is chosen to start), every group, with no change to its table, other quarters', the files in blob storage or the log. Load each group again afterwards.
- **Prisma** reads and writes through the synonym as if it were the table (the `ConsulteeArea` model). `prisma migrate dev` would see `consultee_area` as a missing table, so migrations stay hand-written.

**The upload goes in parts.** One request carrying a whole export (hundreds of MB through Front Door, onto the app's disk, then on to blob storage) can outlast Front Door's response timeout. So the upload page's script (`public/javascripts/blob-upload.js`) sends the file 8MB at a time, four parts at once, each tried up to three times: `POST /admin/upload-to-blob/blocks?name=<file>&block=<n>` stages each as a block of the blob, then `POST /admin/upload-to-blob/commit` commits them in order (`admin/upload-to-blob/controller.ts`). The app never holds or writes the whole file, and a blob isn't replaced until every part has arrived. The CSRF token travels in an `x-csrf-token` header, since each body is the file's bytes. Without JavaScript the form posts the whole file, as before. A group's form saves the file under its group's name; the **Another file** form saves it under its own (`all-project-boundaries.geojson` for the case boundaries).

**Permissions:** the DB Seed pipeline's identity has no data-plane role on the container, so its full-data import fails with 403. Terraform can't grant one (an ABAC condition on the pipeline identity refuses it). Until the platform team grants Storage Blob Data Reader, use the admin pages.

An import (`loadConsulteeAreas`, `loadCaseBoundaries` in `packages/database/src/geospatial/`):

1. Reads the GeoJSON (camelCase sample or snake_case export properties).
2. Gives each consultee area its category. The export's `consultee_category` is a broad group (Health, Local Authorities, Transport...), and each id names its dataset (`health_AMB_EW_00001` is from `AMB_EW`). [`config/reference-data.yaml`](../../config/reference-data.yaml) maps each dataset to the category the rulesets use (Ambulance Trust), and the group goes in `consulteeGroup`. An id with no dataset code (the small sample's) keeps the file's category. A file holding a dataset the config doesn't list isn't imported at all, and the page names it.
3. Derives a stable id per row, so re-importing updates in place.
4. Converts to WKT, fixing winding.
5. Upserts 200 rows per round trip: one `MERGE` per batch, rows as JSON through `OPENJSON`. Seconds instead of tens of minutes.
6. Runs `MakeValid()` and builds `geometrySimplified`.

**Consultee areas are always replaced.** Every import, from the admin page, the DB Seed pipeline or the CLI, clears the whole table and loads the file, so the table holds exactly the latest export and nothing from an earlier one. It clears in batches of 500, but only once the file has been read through and holds at least one feature, so a missing or bad file leaves the data as it was. Clear and load aren't one transaction: if the load fails partway, re-run it. A full import can outlast Front Door's timeout: the browser shows an error while the import carries on, so reload the admin page and check the counts rather than submitting again. Case boundaries merge by id - the admin page's import never replaces them, so it can't delete what CBOS imported; only the DB Seed pipeline's `replaceExistingData=true` can.

The import reads the file a feature at a time and loads about 32MB of it at once, so a 500MB export imports within a 1GB heap.

**Import the full export, not the `_simplified` one.** The simplified file is about 55m coarser (up to 137m for interconnectors), and screening's margins assume the 10m `geometrySimplified` the import builds from the full shapes.

## Case boundaries from CBOS

CBOS (the IDAS back office) is PINS's system of record for cases. A case officer uploads a project's boundary as a shapefile ZIP to the case's "GIS Shapefiles" folder, and CBOS's own `process-shapefile` job converts it to WGS84 GeoJSON, stores it next to the ZIP and records it as the document's next version (`application/geo+json`). Each feature carries `caseReference`, `projectName`, `fileName` and `receivedDate`, the properties the file import reads.

`/admin/import-from-cbos` (**Import cases from CBOS**, which also shows how many cases and boundaries are in the database) asks the Python function (the only app with CBOS access, as its managed identity) for every GeoJSON version of every live file in those folders - a replaced boundary's earlier versions too - then saves each as one `case_boundary` row:

- The id is the file import's (case reference and file name), so a boundary already loaded from a file is updated, not duplicated. When two of a case's files share a name (a ZIP replaced by another of the same name), the newest keeps it and each older one is named for its version, "site.geojson (version 2)" (`distinctFileNames`).
- A case keeps every boundary it's had: its boundary page lists them all to pick from, and everywhere else (search, Nearby NSIPs) a case is its newest.
- A file's features (a site and its access routes, say) become one MultiPolygon. The loader corrects winding and runs `MakeValid()` as for any import.
- The project name is CBOS's current case title, not the one stamped on the GeoJSON.
- `acceptance` is the case's stage now, labelled as CBOS labels it: Pre-Application, Acceptance, Pre-Examination, Examination, Recommendation, Decision, Post-Decision or Withdrawn (the `CaseStatus` row that's `valid`; any other value, such as a draft case's, is left blank). The search page shows it as a tag. It's the stage when the import last ran, so run it again to bring stages up to date. If the function can't read `CaseStatus`, the files are still imported, without stages, and the function logs a warning.
- A file whose coordinates aren't longitude and latitude is turned away. CBOS only reprojects when the ZIP has a `.prj` file, and accepts one without.
- `metadata` records `source: "cbos"` and the CBOS document id and version.
- It merges and never deletes. A file that can't be read is listed on the page and skipped.

Nothing else is done to the geometry: screening simplifies the site to 10m when it runs, as for any boundary.

**When the import fails altogether**, the page runs the function's CBOS connection check (`/api/cbos/health`) and shows it under **What went wrong**: whether the function could sign in to CBOS's database and read its documents, and if not, the error. "Login failed for user '<token-identified principal>'" means the environment's function app (`pins-func-consultees-orchestrator-<env>`) has no user in CBOS's database. Terraform can't make one, so CBOS's database owners create it in SQL (`CREATE USER [...] FROM EXTERNAL PROVIDER`, with read access including `CaseStatus`), once for each environment. A timeout or "server was not found" is the network (the VNet peering or private DNS in `idas-back-office.tf` and `networking.tf`). A failed documents check is the Storage Blob Data Reader role, which Terraform grants.

**When a case's boundary isn't imported**, the usual reasons are a ZIP CBOS marked `invalid`, one never virus checked and so never sent for conversion, a ZIP with no `.prj` (GeoJSON in grid metres, turned away above), or a file outside a GIS Shapefiles folder. CBOS's historical boundaries migration adds its GeoJSON as version 1 of a new document, so the import reads those too, once it has run in that environment.

1. Edit `schema.prisma`, then run `npx prisma migrate dev --create-only` in `packages/database`.
2. Hand-add what Prisma can't express: spatial indexes, `CHECK` constraints, backfills. A new column can't be referenced in the batch that adds it, so wrap later statements in `EXEC('...')` (see the simplified-geometry migration).
3. Deploy runs `prisma migrate deploy`, including any backfill, so time it against the full dataset first (the simplified-geometry backfill took 11s locally for 18,258 rows).

Keep `SIMPLIFY_TOLERANCE_METRES` equal in `geospatial/consultee-areas.ts`, the migration and `apps/function-python/intersector/tolerances.py`.
