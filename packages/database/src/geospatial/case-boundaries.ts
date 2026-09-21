import type { PrismaClient } from '../client/client.ts';
import { Prisma } from '../client/client.ts';
import type { Geometry } from './wkt.ts';
import { geometryToWkt, wktToGeometry } from './wkt.ts';

export interface CaseBoundaryProperties {
	caseReference: string;
	caseName: string;
	fileName?: string | null;
	receivedDate?: Date | null;
	acceptance?: string | null;
	metadata?: Record<string, unknown>;
}

export interface CaseBoundaryFeature {
	id: string;
	type: 'Feature';
	geometry: Geometry;
	properties: CaseBoundaryProperties;
}

export interface CaseBoundaryFeatureCollection {
	type: 'FeatureCollection';
	features: CaseBoundaryFeature[];
}

export interface CaseBoundaryMatch {
	feature: CaseBoundaryFeature;
	distanceMetres: number;
}

interface CaseBoundaryRow {
	id: string;
	geometryType: string;
	caseReference: string;
	caseName: string;
	fileName: string | null;
	receivedDate: Date | null;
	acceptance: string | null;
	metadata: string;
	geometryWkt: string;
}

function rowToFeature(row: CaseBoundaryRow): CaseBoundaryFeature {
	return {
		id: row.id,
		type: 'Feature',
		geometry: wktToGeometry(row.geometryWkt),
		properties: {
			caseReference: row.caseReference,
			caseName: row.caseName,
			fileName: row.fileName,
			receivedDate: row.receivedDate,
			acceptance: row.acceptance,
			metadata: JSON.parse(row.metadata)
		}
	};
}

/**
 * Upsert (by id) every feature in `featureCollection` into case_boundary. Safe to re-run over
 * data that's already there.
 */
export async function loadCaseBoundaries(
	dbClient: PrismaClient,
	featureCollection: CaseBoundaryFeatureCollection
): Promise<number> {
	for (const feature of featureCollection.features) {
		const wkt = geometryToWkt(feature.geometry);
		const properties = feature.properties;
		const metadata = JSON.stringify(properties.metadata ?? {});

		await dbClient.$executeRaw`
			MERGE INTO case_boundary AS target
			USING (SELECT
				CAST(${feature.id} AS UNIQUEIDENTIFIER) AS id,
				CAST(${feature.geometry.type} AS NVARCHAR(50)) AS geometryType,
				-- .MakeValid() is a no-op for already-valid geometry, and repairs minor
				-- self-intersections real-world boundary simplification introduces
				geography::STGeomFromText(${wkt}, 4326).MakeValid() AS geometry,
				CAST(${properties.caseReference} AS NVARCHAR(50)) AS caseReference,
				CAST(${properties.caseName} AS NVARCHAR(500)) AS caseName,
				CAST(${properties.fileName ?? null} AS NVARCHAR(500)) AS fileName,
				CAST(${properties.receivedDate ?? null} AS DATETIME2) AS receivedDate,
				CAST(${properties.acceptance ?? null} AS NVARCHAR(50)) AS acceptance,
				CAST(${metadata} AS NVARCHAR(MAX)) AS metadata
			) AS source
			ON target.id = source.id
			WHEN MATCHED THEN UPDATE SET
				geometryType = source.geometryType,
				geometry = source.geometry,
				caseReference = source.caseReference,
				caseName = source.caseName,
				fileName = source.fileName,
				receivedDate = source.receivedDate,
				acceptance = source.acceptance,
				metadata = source.metadata,
				lastUpdated = SYSUTCDATETIME()
			WHEN NOT MATCHED THEN INSERT (
				id, geometryType, geometry, caseReference, caseName, fileName, receivedDate,
				acceptance, metadata
			) VALUES (
				source.id, source.geometryType, source.geometry, source.caseReference,
				source.caseName, source.fileName, source.receivedDate, source.acceptance,
				source.metadata
			);
		`;
	}
	return featureCollection.features.length;
}

// a plain, developer-controlled (never user input) column list - safe to inline as raw SQL via
// Prisma.raw() below, which is Prisma's documented escape hatch for trusted, non-parameter SQL text
const selectColumns = Prisma.raw(`
	id, geometryType, caseReference, caseName, fileName, receivedDate, acceptance, metadata,
	geometry.STAsText() AS geometryWkt
`);

export interface ListOptions {
	limit?: number;
	offset?: number;
}

/**
 * Read back stored case boundaries, optionally paginated. With no `limit`, fetches everything -
 * fine while the table is small; pass `limit`/`offset` once it's large enough that this stops
 * being reasonable.
 */
export async function listCaseBoundaries(
	dbClient: PrismaClient,
	options: ListOptions = {}
): Promise<CaseBoundaryFeatureCollection> {
	const { limit, offset = 0 } = options;

	const rows =
		limit === undefined
			? await dbClient.$queryRaw<CaseBoundaryRow[]>`SELECT ${selectColumns} FROM case_boundary`
			: await dbClient.$queryRaw<CaseBoundaryRow[]>`
					SELECT ${selectColumns} FROM case_boundary
					-- SQL Server requires ORDER BY for OFFSET/FETCH; the primary key gives a stable
					-- order without needing a table-specific column
					ORDER BY id OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
				`;

	return { type: 'FeatureCollection', features: rows.map(rowToFeature) };
}

/**
 * Find case boundaries within `radiusMetres` of `geometry`, nearest first. `STDistance` returns
 * true great-circle metres for `geography` columns, so a single threshold behaves consistently
 * regardless of latitude - don't compare raw WGS84 degrees as if they were a distance unit.
 */
export async function findCaseBoundariesNear(
	dbClient: PrismaClient,
	geometry: Geometry,
	radiusMetres: number
): Promise<CaseBoundaryMatch[]> {
	const wkt = geometryToWkt(geometry);
	const rows = await dbClient.$queryRaw<(CaseBoundaryRow & { distanceMetres: number })[]>`
		SELECT ${selectColumns},
			geometry.STDistance(geography::STGeomFromText(${wkt}, 4326)) AS distanceMetres
		FROM case_boundary
		WHERE geometry.STDistance(geography::STGeomFromText(${wkt}, 4326)) <= ${radiusMetres}
		ORDER BY distanceMetres
	`;
	return rows.map((row) => ({ feature: rowToFeature(row), distanceMetres: row.distanceMetres }));
}

/**
 * Find case boundaries that intersect `geometry`.
 */
export async function findCaseBoundariesIntersecting(
	dbClient: PrismaClient,
	geometry: Geometry
): Promise<CaseBoundaryFeatureCollection> {
	const wkt = geometryToWkt(geometry);
	const rows = await dbClient.$queryRaw<CaseBoundaryRow[]>`
		SELECT ${selectColumns}
		FROM case_boundary
		WHERE geometry.STIntersects(geography::STGeomFromText(${wkt}, 4326)) = 1
	`;
	return { type: 'FeatureCollection', features: rows.map(rowToFeature) };
}
