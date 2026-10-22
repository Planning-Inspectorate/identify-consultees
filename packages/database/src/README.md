# Database

SQL Server through [Prisma](https://www.prisma.io/). The schema is [`schema.prisma`](./schema.prisma).

## Changing the schema

1. Edit `schema.prisma`.
2. In this package, write the migration without applying it: `npx prisma migrate dev --create-only --name <name>`.
3. **Delete every statement about `consultee_area` or `consultee_area_<quarter>`** from the generated SQL, unless the change is to the consultee areas (see below).
4. Apply it with `npm run db-migrate-prod` from the root, and commit the schema and the migration.

Never run `npm run db-migrate-dev` against a database whose data you want to keep. `npm start`, CI and the deployed environments all apply migrations with `prisma migrate deploy`.

### Consultee areas are a table per quarter

Each quarter has its own table (`consultee_area_2026Q4`), and `consultee_area` is a **synonym** for the one in use (see the `20261022090000_consultee_area_quarterly_datasets` migration and [`kt-docs/data/data-model.md`](../../../kt-docs/data/data-model.md)). Prisma can't see synonyms, so a generated migration tries to drop the quarter's table, with all its rows, and create an empty `consultee_area`. That's why step 3 deletes those statements.

To change the consultee areas' columns, write the migration by hand: alter every `consultee_area_<quarter>` table, and the table that `dbo.create_consultee_area_dataset` creates for a new quarter.

## Geometry (`GEOGRAPHY`)

`ConsulteeArea` and `CaseBoundary` store their shapes as SQL Server `GEOGRAPHY` (WGS84, SRID 4326). Prisma has no type for it, so these columns are `Unsupported("geography")`:

- **Read and write them with raw SQL.** `geography::STGeomFromText(wkt, 4326)` writes them and `.STAsText()` reads them, as in [`geospatial/consultee-areas.ts`](./geospatial/consultee-areas.ts) and [`geospatial/case-boundaries.ts`](./geospatial/case-boundaries.ts).
- **Add spatial indexes and `geometryType` checks to the migration by hand**, as in the `add_geometry_tables` migration. Without a spatial index, `STDistance` and `STIntersects` scan the whole table.
- **Convert GeoJSON with [`geospatial/wkt.ts`](./geospatial/wkt.ts).** It fixes ring winding, which SQL Server needs (outer rings anticlockwise) and may otherwise silently invert.
- **`STDistance` returns metres** on a `geography`. Never compare degrees as if they were a distance.
- **Screening uses `geometrySimplified`** (simplified to 10m on import), while `geometry` keeps the original. Keep `SIMPLIFY_TOLERANCE_METRES` in `geospatial/consultee-areas.ts` equal to the one in `apps/function-python/intersector/tolerances.py`.

## Conventions

- **Ids** are GUIDs, `@id @default(dbgenerated("newid()")) @db.UniqueIdentifier`, so ids in URLs are hard to guess.
- **Names** follow [Prisma's conventions](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference#naming-conventions): PascalCase models and relations, camelCase columns.
- **`String`** is `nvarchar(1000)`. Set a size where that's wrong, such as `@db.NVarChar(2000)`.
- **Comment** models and fields. `///` comments reach the generated types; `//` comments stay in the schema.
