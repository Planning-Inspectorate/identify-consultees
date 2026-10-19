import type { PrismaClient } from '../client/client.ts';
import { Prisma } from '../client/client.ts';
import { withDeadlockRetry } from './db-retry.ts';
import type { Geometry } from './wkt.ts';
import { geometryToWkt, wktToGeometry } from './wkt.ts';

/**
 * The ruleset's distance and bordering checks (apps/function-python) run against simplified
 * geometries (Douglas-Peucker, this tolerance), which the loader below stores alongside the
 * original: every point of a simplified shape is within this distance of the original, at a
 * fraction of the points to compare - a 2,536-point site boundary drops to 66. Original geometries
 * are kept for the map. Must match the migration that backfilled consultee_area.geometrySimplified.
 */
export const SIMPLIFY_TOLERANCE_METRES = 10;

/** A consultee area's fields, as the reference data export gives them - see schema.prisma. */
export interface ConsulteeAreaProperties {
	/** The export's own id. */
	sourceId?: string | null;
	/** The category the rulesets match. */
	consulteeCategory?: string | null;
	/** The export's broad group: Health, Local Authorities, Transport... */
	consulteeGroup?: string | null;
	consultee?: string | null;
	region?: string | null;
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

/** A consultee area without its geometry - for listings that never draw it. */
export interface ConsulteeAreaSummary {
	id: string;
	properties: ConsulteeAreaProperties;
}

interface ConsulteeAreaSummaryRow {
	id: string;
	geometryType: string;
	sourceId: string | null;
	consulteeCategory: string | null;
	consulteeGroup: string | null;
	consultee: string | null;
	region: string | null;
	metadata: string;
}

interface ConsulteeAreaRow extends ConsulteeAreaSummaryRow {
	geometryWkt: string;
}

function rowToSummary(row: ConsulteeAreaSummaryRow): ConsulteeAreaSummary {
	return {
		id: row.id,
		properties: {
			sourceId: row.sourceId,
			consulteeCategory: row.consulteeCategory,
			consulteeGroup: row.consulteeGroup,
			consultee: row.consultee,
			region: row.region,
			metadata: JSON.parse(row.metadata)
		}
	};
}

function rowToFeature(row: ConsulteeAreaRow): ConsulteeAreaFeature {
	return { ...rowToSummary(row), type: 'Feature', geometry: wktToGeometry(row.geometryWkt) };
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
				sourceId: feature.properties.sourceId ?? null,
				consulteeGroup: feature.properties.consulteeGroup ?? null,
				// pre-stringified rather than nested JSON - OPENJSON's WITH clause extracts a
				// declared NVARCHAR column as a scalar string, not a nested object
				metadata: JSON.stringify(feature.properties.metadata ?? {})
			}))
		);

		await dbClient.$executeRaw`
			MERGE INTO consultee_area AS target
			USING (
				SELECT parsed.*, parsed.geometry.Reduce(${SIMPLIFY_TOLERANCE_METRES}).MakeValid() AS geometrySimplified
				FROM (
					SELECT
						id,
						geometryType,
						-- .MakeValid() is a no-op for already-valid geometry, and repairs minor
						-- self-intersections real-world boundary simplification introduces
						geography::STGeomFromText(wkt, 4326).MakeValid() AS geometry,
						consulteeCategory,
						consultee,
						region,
						sourceId,
						consulteeGroup,
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
						sourceId NVARCHAR(200) '$.sourceId',
						consulteeGroup NVARCHAR(100) '$.consulteeGroup',
						metadata NVARCHAR(MAX) '$.metadata'
					)
				) AS parsed
			) AS source
			ON target.id = source.id
			WHEN MATCHED THEN UPDATE SET
				geometryType = source.geometryType,
				geometry = source.geometry,
				geometrySimplified = source.geometrySimplified,
				consulteeCategory = source.consulteeCategory,
				consultee = source.consultee,
				region = source.region,
				sourceId = source.sourceId,
				consulteeGroup = source.consulteeGroup,
				metadata = source.metadata,
				lastUpdated = SYSUTCDATETIME()
			WHEN NOT MATCHED THEN INSERT (
				id, geometryType, geometry, geometrySimplified, sourceId, consulteeCategory, consulteeGroup, consultee,
				region, metadata
			) VALUES (
				source.id, source.geometryType, source.geometry, source.geometrySimplified, source.sourceId,
				source.consulteeCategory, source.consulteeGroup, source.consultee, source.region, source.metadata
			);
		`;

		onProgress?.(Math.min(i + batchSize, features.length), features.length);
	}
	return features.length;
}

// a plain, developer-controlled (never user input) column list - safe to inline as raw SQL via
// Prisma.raw() below, which is Prisma's documented escape hatch for trusted, non-parameter SQL text
const summaryColumnList = `
	id, geometryType, sourceId, consulteeCategory, consulteeGroup, consultee, region, metadata
`;
const selectColumns = Prisma.raw(`${summaryColumnList}, geometry.STAsText() AS geometryWkt`);

/**
 * Look up a single consultee area by id. Returns `null` rather than throwing when the id is
 * well-formed but doesn't match any row - a genuine "not found", not an error.
 */
export async function getConsulteeAreaById(dbClient: PrismaClient, id: string): Promise<ConsulteeAreaFeature | null> {
	const rows = await withDeadlockRetry(
		() => dbClient.$queryRaw<ConsulteeAreaRow[]>`
			SELECT ${selectColumns} FROM consultee_area WHERE id = CAST(${id} AS UNIQUEIDENTIFIER)
		`
	);
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

	const rows = await withDeadlockRetry(() =>
		limit === undefined
			? dbClient.$queryRaw<ConsulteeAreaRow[]>`SELECT ${selectColumns} FROM consultee_area`
			: dbClient.$queryRaw<ConsulteeAreaRow[]>`
					SELECT ${selectColumns} FROM consultee_area
					-- SQL Server requires ORDER BY for OFFSET/FETCH; the primary key gives a stable
					-- order without needing a table-specific column
					ORDER BY id OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
				`
	);

	return { type: 'FeatureCollection', features: rows.map(rowToFeature) };
}

// SQL Server caps a single statement at 2,100 parameters
const GEOMETRY_LOOKUP_BATCH_SIZE = 1000;

/** Douglas-Peucker tolerance for geometry that's only drawn, never measured - see getConsulteeAreaDisplayGeometries. */
export const DISPLAY_SIMPLIFY_TOLERANCE_METRES = 25;

/**
 * Larger areas are drawn coarser: tolerance is the area's width (the square root of its area)
 * divided by this, or DISPLAY_SIMPLIFY_TOLERANCE_METRES if that's larger. A parish stays at 25m; a
 * 3,000km² county is simplified to ~270m, which can't be seen at the zoom it fills the map at.
 */
export const DISPLAY_SIMPLIFY_WIDTH_RATIO = 200;

/**
 * `geometry` grown by `metres`, for drawing - e.g. a site's search area. Simplified first and
 * built to display tolerance: a detailed 180km route would otherwise take seconds to buffer by
 * kilometres, into an outline with far more points than any map needs.
 */
export async function bufferGeometryForDisplay(
	dbClient: PrismaClient,
	geometry: Geometry,
	metres: number
): Promise<Geometry> {
	const [row] = await withDeadlockRetry(
		() => dbClient.$queryRaw<{ wkt: string }[]>`
			SELECT geography::STGeomFromText(${geometryToWkt(geometry)}, 4326)
				.Reduce(${DISPLAY_SIMPLIFY_TOLERANCE_METRES})
				.BufferWithTolerance(${metres}, ${DISPLAY_SIMPLIFY_TOLERANCE_METRES}, 0)
				.STAsText() AS wkt
		`
	);
	return wktToGeometry(row.wkt);
}

/**
 * Whole geometry of specific consultee areas for drawing around a site, for those that touch
 * `window` - simplified more the larger they are (see DISPLAY_SIMPLIFY_WIDTH_RATIO). Regional
 * areas - counties, police forces, health boards - are detailed, coastline and all: at a flat 25m,
 * the areas within 20km of Norwich to Tilbury come to ~3.8MB; simplified by size, ~1.5MB.
 * Display only - never measure distances on these. Ids with no matching row, or not touching
 * `window`, are absent.
 */
export async function getConsulteeAreaDisplayGeometries(
	dbClient: PrismaClient,
	ids: string[],
	window: Geometry
): Promise<Map<string, Geometry>> {
	const windowWkt = geometryToWkt(window);
	const geometries = new Map<string, Geometry>();
	for (let i = 0; i < ids.length; i += GEOMETRY_LOOKUP_BATCH_SIZE) {
		const batch = ids.slice(i, i + GEOMETRY_LOOKUP_BATCH_SIZE);
		const rows = await withDeadlockRetry(
			() => dbClient.$queryRaw<{ id: string; geometryWkt: string }[]>`
				SELECT id, geometrySimplified.Reduce(tolerance.metres).STAsText() AS geometryWkt
				FROM consultee_area
				CROSS APPLY (
					SELECT CASE
						WHEN SQRT(geometrySimplified.STArea()) / ${DISPLAY_SIMPLIFY_WIDTH_RATIO} > ${DISPLAY_SIMPLIFY_TOLERANCE_METRES}
							THEN SQRT(geometrySimplified.STArea()) / ${DISPLAY_SIMPLIFY_WIDTH_RATIO}
						ELSE ${DISPLAY_SIMPLIFY_TOLERANCE_METRES}
					END AS metres
				) AS tolerance
				WHERE id IN (${Prisma.join(batch)})
					AND geometrySimplified.STIntersects(geography::STGeomFromText(${windowWkt}, 4326)) = 1
			`
		);
		for (const row of rows) {
			geometries.set(row.id, wktToGeometry(row.geometryWkt));
		}
	}
	return geometries;
}

/** Every consultee category in the reference data, alphabetically. */
export async function listConsulteeCategories(dbClient: PrismaClient): Promise<string[]> {
	const rows = await withDeadlockRetry(
		() => dbClient.$queryRaw<{ consulteeCategory: string }[]>`
			SELECT DISTINCT consulteeCategory FROM consultee_area
			WHERE consulteeCategory IS NOT NULL
			ORDER BY consulteeCategory
		`
	);
	return rows.map((row) => row.consulteeCategory);
}

/** A consultee found by its name - see findConsulteeAreaByName. */
export interface NamedConsulteeArea {
	/** Lowercase, as the Python function and the report's URLs give consultee_area ids. */
	id: string;
	/** As the reference data spells it. */
	consultee: string;
	distanceMetres: number;
}

/**
 * The consultee_area row in `category` called `name` - case aside, as names are compared when
 * consultees are added by hand - nearest `site` when several share it, or `undefined` when there's
 * none: the check that a name typed on the Add a consultee page is a real consultee.
 */
export async function findConsulteeAreaByName(
	dbClient: PrismaClient,
	category: string,
	name: string,
	site: Geometry
): Promise<NamedConsulteeArea | undefined> {
	const [row] = await withDeadlockRetry(
		() => dbClient.$queryRaw<{ id: string; consultee: string; distanceMetres: number }[]>`
			SELECT TOP 1 id, consultee,
				geometrySimplified.STDistance(geography::STGeomFromText(${geometryToWkt(site)}, 4326)) AS distanceMetres
			FROM consultee_area
			WHERE consulteeCategory = ${category}
				AND LOWER(consultee) = LOWER(${name})
			ORDER BY distanceMetres, id
		`
	);
	return row ? { id: row.id.toLowerCase(), consultee: row.consultee, distanceMetres: row.distanceMetres } : undefined;
}
