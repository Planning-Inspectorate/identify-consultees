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

export interface LoadOptions {
	/**
	 * Rows per round trip. Default is tuned for typical consultee area geometries; pass a smaller
	 * value for unusually large/complex geometries (e.g. detailed national rail/road networks),
	 * since the whole batch travels as a single JSON parameter.
	 */
	batchSize?: number;
	onProgress?: (loaded: number, total: number) => void;
}

const DEFAULT_LOAD_BATCH_SIZE = 200;

/**
 * Upsert (by id) every feature in `featureCollection` into consultee_area, `batchSize` rows per
 * round trip via `OPENJSON` rather than one round trip per row - the difference between a load
 * that takes seconds and one that takes tens of minutes once this holds a real, large dataset.
 * Safe to re-run over data that's already there.
 */
export async function loadConsulteeAreas(
	dbClient: PrismaClient,
	featureCollection: ConsulteeAreaFeatureCollection,
	options: LoadOptions = {}
): Promise<number> {
	const { batchSize = DEFAULT_LOAD_BATCH_SIZE, onProgress } = options;
	const features = featureCollection.features;

	for (let i = 0; i < features.length; i += batchSize) {
		// MERGE can't join against a source with duplicate keys within one statement - real source
		// data can genuinely contain exact-duplicate rows (the same id computed twice); keep the
		// last occurrence, matching what a sequential per-row load would do (each write overwrites
		// the last)
		const batch = [...new Map(features.slice(i, i + batchSize).map((feature) => [feature.id, feature])).values()];
		const batchJson = JSON.stringify(
			batch.map((feature) => ({
				id: feature.id,
				geometryType: feature.geometry.type,
				wkt: geometryToWkt(feature.geometry),
				consulteeCategory: feature.properties.consulteeCategory ?? null,
				consultee: feature.properties.consultee ?? null,
				region: feature.properties.region ?? null,
				caseReference: feature.properties.caseReference ?? null,
				documentId: feature.properties.documentId ?? null,
				consulteeId: feature.properties.consulteeId ?? null,
				organisationId: feature.properties.organisationId ?? null,
				currentVersion: feature.properties.currentVersion ?? 1,
				// pre-stringified rather than nested JSON - OPENJSON's WITH clause extracts a
				// declared NVARCHAR column as a scalar string, not a nested object
				metadata: JSON.stringify(feature.properties.metadata ?? {})
			}))
		);

		await dbClient.$executeRaw`
			MERGE INTO consultee_area AS target
			USING (
				SELECT
					id,
					geometryType,
					-- .MakeValid() is a no-op for already-valid geometry, and repairs minor
					-- self-intersections real-world boundary simplification introduces
					geography::STGeomFromText(wkt, 4326).MakeValid() AS geometry,
					consulteeCategory,
					consultee,
					region,
					caseReference,
					documentId,
					consulteeId,
					organisationId,
					currentVersion,
					metadata
				FROM OPENJSON(${batchJson})
				WITH (
					id UNIQUEIDENTIFIER '$.id',
					geometryType NVARCHAR(50) '$.geometryType',
					-- NVARCHAR(MAX) here (not JSON_VALUE, which silently returns NULL past 4000
					-- characters) - real geometry WKT routinely exceeds that
					wkt NVARCHAR(MAX) '$.wkt',
					consulteeCategory NVARCHAR(200) '$.consulteeCategory',
					consultee NVARCHAR(200) '$.consultee',
					region NVARCHAR(100) '$.region',
					caseReference NVARCHAR(50) '$.caseReference',
					documentId UNIQUEIDENTIFIER '$.documentId',
					consulteeId UNIQUEIDENTIFIER '$.consulteeId',
					organisationId UNIQUEIDENTIFIER '$.organisationId',
					currentVersion INT '$.currentVersion',
					metadata NVARCHAR(MAX) '$.metadata'
				)
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

		onProgress?.(Math.min(i + batchSize, features.length), features.length);
	}
	return features.length;
}

// a plain, developer-controlled (never user input) column list - safe to inline as raw SQL via
// Prisma.raw() below, which is Prisma's documented escape hatch for trusted, non-parameter SQL text
const selectColumns = Prisma.raw(`
	id, geometryType, consulteeCategory, consultee, region, caseReference, documentId,
	consulteeId, organisationId, currentVersion, metadata, geometry.STAsText() AS geometryWkt
`);

/**
 * Look up a single consultee area by id. Returns `null` rather than throwing when the id is
 * well-formed but doesn't match any row - a genuine "not found", not an error.
 */
export async function getConsulteeAreaById(dbClient: PrismaClient, id: string): Promise<ConsulteeAreaFeature | null> {
	const rows = await dbClient.$queryRaw<ConsulteeAreaRow[]>`
		SELECT ${selectColumns} FROM consultee_area WHERE id = CAST(${id} AS UNIQUEIDENTIFIER)
	`;
	return rows[0] ? rowToFeature(rows[0]) : null;
}

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
 *
 * `consulteeCategory`, when given, restricts to that category only (e.g. 'railway') - the
 * per-category distance/inclusion rules a real ruleset would define aren't modelled yet, this is
 * just enough to run one rule for real.
 */
export async function findConsulteeAreasNear(
	dbClient: PrismaClient,
	geometry: Geometry,
	radiusMetres: number,
	consulteeCategory?: string
): Promise<ConsulteeAreaMatch[]> {
	const wkt = geometryToWkt(geometry);
	const rows = await dbClient.$queryRaw<(ConsulteeAreaRow & { distanceMetres: number })[]>`
		SELECT ${selectColumns},
			geometry.STDistance(geography::STGeomFromText(${wkt}, 4326)) AS distanceMetres
		FROM consultee_area
		WHERE geometry.STDistance(geography::STGeomFromText(${wkt}, 4326)) <= ${radiusMetres}
			AND (${consulteeCategory ?? null} IS NULL OR consulteeCategory = ${consulteeCategory ?? null})
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
