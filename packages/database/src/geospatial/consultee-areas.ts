import type { PrismaClient } from '../client/client.ts';
import { Prisma } from '../client/client.ts';
import type { Geometry } from './wkt.ts';
import { geometryToWkt, wktToGeometry } from './wkt.ts';

export interface ConsulteeAreaProperties {
	consulteeCategory?: string | null;
	consultee?: string | null;
	region?: string | null;
	// loose value-link to a case, not an FK - see schema.prisma
	caseReference?: string | null;
	documentId?: string | null;
	consulteeId?: string | null;
	organisationId?: string | null;
	currentVersion?: number;
	metadata?: Record<string, unknown>;
}

export interface ConsulteeAreaFeature {
	id: string;
	type: 'Feature';
	geometry: Geometry;
	properties: ConsulteeAreaProperties;
}

export interface ConsulteeAreaFeatureCollection {
	type: 'FeatureCollection';
	features: ConsulteeAreaFeature[];
}

export interface ConsulteeAreaMatch {
	feature: ConsulteeAreaFeature;
	distanceMetres: number;
}

interface ConsulteeAreaRow {
	id: string;
	geometryType: string;
	consulteeCategory: string | null;
	consultee: string | null;
	region: string | null;
	caseReference: string | null;
	documentId: string | null;
	consulteeId: string | null;
	organisationId: string | null;
	currentVersion: number;
	metadata: string;
	geometryWkt: string;
}

function rowToFeature(row: ConsulteeAreaRow): ConsulteeAreaFeature {
	return {
		id: row.id,
		type: 'Feature',
		geometry: wktToGeometry(row.geometryWkt),
		properties: {
			consulteeCategory: row.consulteeCategory,
			consultee: row.consultee,
			region: row.region,
			caseReference: row.caseReference,
			documentId: row.documentId,
			consulteeId: row.consulteeId,
			organisationId: row.organisationId,
			currentVersion: row.currentVersion,
			metadata: JSON.parse(row.metadata)
		}
	};
}

/**
 * Upsert (by id) every feature in `featureCollection` into consultee_area. Safe to re-run over
 * data that's already there.
 */
export async function loadConsulteeAreas(
	dbClient: PrismaClient,
	featureCollection: ConsulteeAreaFeatureCollection
): Promise<number> {
	for (const feature of featureCollection.features) {
		const wkt = geometryToWkt(feature.geometry);
		const properties = feature.properties;
		const metadata = JSON.stringify(properties.metadata ?? {});

		await dbClient.$executeRaw`
			MERGE INTO consultee_area AS target
			USING (SELECT
				CAST(${feature.id} AS UNIQUEIDENTIFIER) AS id,
				CAST(${feature.geometry.type} AS NVARCHAR(50)) AS geometryType,
				-- .MakeValid() is a no-op for already-valid geometry, and repairs minor
				-- self-intersections real-world boundary simplification introduces
				geography::STGeomFromText(${wkt}, 4326).MakeValid() AS geometry,
				CAST(${properties.consulteeCategory ?? null} AS NVARCHAR(200)) AS consulteeCategory,
				CAST(${properties.consultee ?? null} AS NVARCHAR(200)) AS consultee,
				CAST(${properties.region ?? null} AS NVARCHAR(100)) AS region,
				CAST(${properties.caseReference ?? null} AS NVARCHAR(50)) AS caseReference,
				CAST(${properties.documentId ?? null} AS UNIQUEIDENTIFIER) AS documentId,
				CAST(${properties.consulteeId ?? null} AS UNIQUEIDENTIFIER) AS consulteeId,
				CAST(${properties.organisationId ?? null} AS UNIQUEIDENTIFIER) AS organisationId,
				CAST(${properties.currentVersion ?? 1} AS INT) AS currentVersion,
				CAST(${metadata} AS NVARCHAR(MAX)) AS metadata
			) AS source
			ON target.id = source.id
			WHEN MATCHED THEN UPDATE SET
				geometryType = source.geometryType,
				geometry = source.geometry,
				consulteeCategory = source.consulteeCategory,
				consultee = source.consultee,
				region = source.region,
				caseReference = source.caseReference,
				documentId = source.documentId,
				consulteeId = source.consulteeId,
				organisationId = source.organisationId,
				currentVersion = source.currentVersion,
				metadata = source.metadata,
				lastUpdated = SYSUTCDATETIME()
			WHEN NOT MATCHED THEN INSERT (
				id, geometryType, geometry, consulteeCategory, consultee, region, caseReference,
				documentId, consulteeId, organisationId, currentVersion, metadata
			) VALUES (
				source.id, source.geometryType, source.geometry, source.consulteeCategory,
				source.consultee, source.region, source.caseReference, source.documentId,
				source.consulteeId, source.organisationId, source.currentVersion, source.metadata
			);
		`;
	}
	return featureCollection.features.length;
}

// a plain, developer-controlled (never user input) column list - safe to inline as raw SQL via
// Prisma.raw() below, which is Prisma's documented escape hatch for trusted, non-parameter SQL text
const selectColumns = Prisma.raw(`
	id, geometryType, consulteeCategory, consultee, region, caseReference, documentId,
	consulteeId, organisationId, currentVersion, metadata, geometry.STAsText() AS geometryWkt
`);

export interface ListOptions {
	limit?: number;
	offset?: number;
}

/**
 * Read back stored consultee areas, optionally paginated. With no `limit`, fetches everything -
 * fine while the table is small; pass `limit`/`offset` once it's large enough that this stops
 * being reasonable.
 */
export async function listConsulteeAreas(
	dbClient: PrismaClient,
	options: ListOptions = {}
): Promise<ConsulteeAreaFeatureCollection> {
	const { limit, offset = 0 } = options;

	const rows =
		limit === undefined
			? await dbClient.$queryRaw<ConsulteeAreaRow[]>`SELECT ${selectColumns} FROM consultee_area`
			: await dbClient.$queryRaw<ConsulteeAreaRow[]>`
					SELECT ${selectColumns} FROM consultee_area
					-- SQL Server requires ORDER BY for OFFSET/FETCH; the primary key gives a stable
					-- order without needing a table-specific column
					ORDER BY id OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
				`;

	return { type: 'FeatureCollection', features: rows.map(rowToFeature) };
}

/**
 * Find consultee areas within `radiusMetres` of `geometry`, nearest first. `STDistance` returns
 * true great-circle metres for `geography` columns, so a single threshold behaves consistently
 * regardless of latitude - don't compare raw WGS84 degrees as if they were a distance unit.
 */
export async function findConsulteeAreasNear(
	dbClient: PrismaClient,
	geometry: Geometry,
	radiusMetres: number
): Promise<ConsulteeAreaMatch[]> {
	const wkt = geometryToWkt(geometry);
	const rows = await dbClient.$queryRaw<(ConsulteeAreaRow & { distanceMetres: number })[]>`
		SELECT ${selectColumns},
			geometry.STDistance(geography::STGeomFromText(${wkt}, 4326)) AS distanceMetres
		FROM consultee_area
		WHERE geometry.STDistance(geography::STGeomFromText(${wkt}, 4326)) <= ${radiusMetres}
		ORDER BY distanceMetres
	`;
	return rows.map((row) => ({ feature: rowToFeature(row), distanceMetres: row.distanceMetres }));
}

/**
 * Find consultee areas that intersect `geometry`.
 */
export async function findConsulteeAreasIntersecting(
	dbClient: PrismaClient,
	geometry: Geometry
): Promise<ConsulteeAreaFeatureCollection> {
	const wkt = geometryToWkt(geometry);
	const rows = await dbClient.$queryRaw<ConsulteeAreaRow[]>`
		SELECT ${selectColumns}
		FROM consultee_area
		WHERE geometry.STIntersects(geography::STGeomFromText(${wkt}, 4326)) = 1
	`;
	return { type: 'FeatureCollection', features: rows.map(rowToFeature) };
}
