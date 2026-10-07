# Data model

**Status:** Current — schema at migration `20261007090000_add_consultee_area_simplified_geometry`.

> **Being redeveloped:** the data processing is being rebuilt with new ids and a new schema. This page describes today's tables as screening uses them; see [what screening needs from the data](./spatial-screening-engine.md#what-screening-needs-from-the-data) for what any replacement must keep.

Defined in `packages/database/src/schema.prisma`, with spatial details hand-written into the migrations under `packages/database/src/migrations/` (Prisma can't express them).

## `consultee_area` — the areas each consultee covers

One row per area a consultee is responsible for, or a point for site-based consultees such as hospitals.

| Column                                                                                     | Type                                | Notes                                                                                                                                  |
| ------------------------------------------------------------------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                                                       | `UNIQUEIDENTIFIER`, primary key     | Derived from the source row's id                                                                                                       |
| `geometry`                                                                                 | `geography`, not null               | The original shape — drawn on the map                                                                                                  |
| `geometrySimplified`                                                                       | `geography`, not null               | The same shape simplified to 10m — what screening queries run against (see [Simplified geometry](#simplified-geometry))                |
| `geometryType`                                                                             | `NVARCHAR(50)`                      | `CHECK` constraint: `Point`, `MultiPoint`, `LineString`, `MultiLineString`, `Polygon`, `MultiPolygon`, `GeometryCollection`            |
| `consulteeCategory`                                                                        | `NVARCHAR(200)`, indexed            | e.g. `Parish Council`, `Hospital` — what rulesets match on; see the [catalogue](./reference-data-catalogue.md)                         |
| `consultee`                                                                                | `NVARCHAR(200)`                     | Display name, e.g. `Suffolk County Council`                                                                                            |
| `region`                                                                                   | `NVARCHAR(100)`                     | Being worked on separately                                                                                                             |
| `metadata`                                                                                 | `NVARCHAR(MAX)`, JSON, default `{}` | Catch-all for source attributes                                                                                                        |
| `lastUpdated`                                                                              | `DATETIME2`, default now            | Set again whenever an import updates the row                                                                                           |
| `caseReference` (indexed), `documentId`, `consulteeId`, `organisationId`, `currentVersion` | various                             | **Not populated** by the current data (`currentVersion` is always 1). Reserved for linking areas to cases, documents and organisations |

## `case_boundary` — planning case site boundaries

One row per **boundary submission**. A case can have more than one (269 distinct references across 282 rows today), so `caseReference` is not unique.

| Column                     | Type                            | Notes                                         |
| -------------------------- | ------------------------------- | --------------------------------------------- |
| `id`                       | `UNIQUEIDENTIFIER`, primary key | Deterministic from case reference + file name |
| `geometry`                 | `geography`, not null           | The site boundary                             |
| `geometryType`             | `NVARCHAR(50)`                  | Same `CHECK` constraint as above              |
| `caseReference`            | `NVARCHAR(50)`, indexed         | e.g. `EN010102`                               |
| `caseName`                 | `NVARCHAR(500)`                 | Project name                                  |
| `fileName`, `receivedDate` |                                 | Which submission this boundary came from      |
| `acceptance`               | `NVARCHAR(50)`                  | Not populated today                           |
| `metadata`, `lastUpdated`  |                                 | As for `consultee_area`                       |

There's no foreign key between the two tables: screening relates them spatially, not by key.

## Indexes

| Index                                               | On                                  | Purpose                                                                                                                            |
| --------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `consultee_area_geometry_simplified_sidx`           | `consultee_area.geometrySimplified` | Every screening query. Forced with `WITH (INDEX(...))` — see [Spatial screening engine](./spatial-screening-engine.md#query-plans) |
| `consultee_area_geometry_sidx`                      | `consultee_area.geometry`           | Queries on original geometry (e.g. intersects lookups)                                                                             |
| `case_boundary_geometry_sidx`                       | `case_boundary.geometry`            | Spatial queries on case boundaries                                                                                                 |
| `consulteeCategory`, `caseReference` b-tree indexes |                                     | Category filters, case lookups                                                                                                     |

Spatial indexes use `GEOGRAPHY_AUTO_GRID`.

## Spatial conventions

| Convention          | Detail                                                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coordinate system   | WGS84, SRID 4326, stored as `geography` (round-earth). Distances from `STDistance` are metres                                                                                                                                                                 |
| Coordinate order    | GeoJSON `[longitude, latitude]` throughout the code                                                                                                                                                                                                           |
| Ring winding        | SQL Server needs exterior rings counter-clockwise and holes clockwise, and a backwards ring can be read as "the whole globe except this shape". `wkt.ts` corrects winding on the way in. Sliver rings too thin to have a meaningful winding are left as given |
| Validity            | Every geometry passes through `MakeValid()` on import                                                                                                                                                                                                         |
| Reading and writing | Geometry is excluded from the Prisma client (`Unsupported("geography")`), so it's always read/written with raw SQL, as WKT text (`STGeomFromText` / `STAsText`)                                                                                               |
| Parameters          | Query geometries are passed as WKT parameters, never concatenated into SQL                                                                                                                                                                                    |

## Simplified geometry

`geometrySimplified` is `geometry.Reduce(10).MakeValid()`: a Douglas-Peucker simplification in which every point stays within 10m of the original. The migration backfilled it, and every import maintains it. Simplification reduced the reference data's points by 15% (1.69M to 1.44M); 471 small shapes changed type, for example a tiny polygon becoming a line, which doesn't matter for screening. The 10m value must match `SIMPLIFY_TOLERANCE_METRES` in `geospatial/consultee-areas.ts`.

## Changing the schema

1. Edit `schema.prisma`.
2. Generate a migration (`prisma migrate dev --create-only`), then hand-add anything Prisma can't express: spatial indexes, `CHECK` constraints, backfills. A new column can't be referenced in the same batch it's added in, so wrap later statements in `EXEC('...')` — see the simplified-geometry migration.
3. The Deploy pipeline applies pending migrations with `prisma migrate deploy` as part of each deployment. A migration that backfills existing rows runs inside that deployment, so time it against a full dataset first (the simplified-geometry backfill took 11s locally for 18,258 rows).

## Related pages

- [Reference data catalogue](./reference-data-catalogue.md)
- [Spatial screening engine](./spatial-screening-engine.md)
- `packages/database/src/README.md` — developer notes on the same code
