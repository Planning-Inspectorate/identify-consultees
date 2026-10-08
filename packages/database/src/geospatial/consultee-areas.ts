import type { PrismaClient } from '../client/client.ts';
import { Prisma } from '../client/client.ts';
import { withDeadlockRetry } from './db-retry.ts';
import type { Geometry } from './wkt.ts';
import { geometryToWkt, wktToGeometry } from './wkt.ts';

export { isDeadlockError, withDeadlockRetry } from './db-retry.ts';

/**
 * Distance and bordering checks run against simplified geometries (Douglas-Peucker, this
 * tolerance): every point of a simplified shape is within this distance of the original, at a
 * fraction of the points to compare - a 2,536-point site boundary drops to 66. Original geometries
 * are kept for the map. Must match the migration that backfilled consultee_area.geometrySimplified.
 */
export const SIMPLIFY_TOLERANCE_METRES = 10;

/**
 * Simplifying both shapes can move a distance by up to twice the tolerance, so every distance
 * threshold is widened by more than that: simplification can only *add* a borderline consultee,
 * never drop one. The service would rather consult one body too many than miss one.
 */
export const DISTANCE_MARGIN_METRES = 2 * SIMPLIFY_TOLERANCE_METRES + 10;

/**
 * Areas within this distance of each other count as bordering - the simplification error, plus
 * small gaps between boundaries drawn from different sources (e.g. 32m between Sundon parish and
 * Luton's boundary in the reference data, which really do border).
 */
export const BORDERING_TOLERANCE_METRES = 50;

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

/** A consultee area without its geometry - for listings that never draw it. */
export interface ConsulteeAreaSummary {
	id: string;
	properties: ConsulteeAreaProperties;
}

export interface ConsulteeAreaSummaryMatch {
	feature: ConsulteeAreaSummary;
	distanceMetres: number;
}

interface ConsulteeAreaSummaryRow {
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
}

interface ConsulteeAreaRow extends ConsulteeAreaSummaryRow {
	geometryWkt: string;
}

function rowToSummary(row: ConsulteeAreaSummaryRow): ConsulteeAreaSummary {
	return {
		id: row.id,
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
				caseReference = source.caseReference,
				documentId = source.documentId,
				consulteeId = source.consulteeId,
				organisationId = source.organisationId,
				currentVersion = source.currentVersion,
				metadata = source.metadata,
				lastUpdated = SYSUTCDATETIME()
			WHEN NOT MATCHED THEN INSERT (
				id, geometryType, geometry, geometrySimplified, consulteeCategory, consultee, region, caseReference,
				documentId, consulteeId, organisationId, currentVersion, metadata
			) VALUES (
				source.id, source.geometryType, source.geometry, source.geometrySimplified, source.consulteeCategory,
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
const summaryColumnList = `
	id, geometryType, consulteeCategory, consultee, region, caseReference, documentId,
	consulteeId, organisationId, currentVersion, metadata
`;
const summaryColumns = Prisma.raw(summaryColumnList);
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

/**
 * Find consultee areas within `radiusMetres` of `geometry`, nearest first. `STDistance` returns
 * true great-circle metres for `geography` columns, so a single threshold behaves consistently
 * regardless of latitude - don't compare raw WGS84 degrees as if they were a distance unit.
 *
 * Distances are measured between simplified shapes (see SIMPLIFY_TOLERANCE_METRES) - each area's
 * stored `geometrySimplified`, and `geometry` as given, which callers should pass through
 * simplifyGeometry first for speed (an unsimplified one is still correct, just slower). They're
 * approximate, so the radius is widened by DISTANCE_MARGIN_METRES: borderline areas are included,
 * never missed. Returned features still carry their original geometry, for the map.
 *
 * `consulteeCategories`, when given, restricts to those categories only (e.g. `['Railway']`) -
 * this is the query a ruleset runs (see geospatial/rulesets.ts): each ruleset is just a
 * categories + radius pair, so one generic, index-backed query covers all of them.
 *
 * `excludeCategories`, when given, drops those categories instead of restricting to them - for a
 * query with no `consulteeCategories` filter at all (i.e. "any category"), this is the only way to
 * keep a known-pathological category (see rulesets.ts's CATEGORIES_EXCLUDED_FROM_NEARBY) out of the
 * result.
 *
 * `WITH (INDEX(consultee_area_geometry_simplified_sidx))` forces the spatial index as the access path - without
 * it, once this query is genuinely parameterized (as every real caller does it: Prisma always sends
 * `sp_executesql` with out-of-band parameters, never literal SQL text), SQL Server's optimizer can
 * choose to seek the `consulteeCategory` index instead and compute exact `STDistance` against
 * *every* row of that category nationally, ignoring the spatial index's candidate-pruning entirely.
 * This is easy to miss testing locally: the SAME query with the category/radius inlined as literal
 * SQL text (rather than passed as parameters) reliably picks the fast, spatial-index plan on its
 * own, which is why a hint that only nudges the optimizer (e.g. `.Filter()`, or `OPTION (RECOMPILE)`)
 * tested against literal SQL can look like it works and then do nothing once Prisma's real,
 * parameterized query hits the same table - confirmed by reproducing Prisma's exact `sp_executesql`
 * call shape directly: neither `.Filter()` nor `OPTION (RECOMPILE)` changed the plan for every
 * affected category, while this hint fixed all of them, and is a no-op (confirmed, timed) on a query
 * with no category filter at all, which already always chooses the spatial index on its own.
 * Real-data impact measured this way: a 164-row category went from ~1.25s to ~2ms; a 40-row category
 * of unusually complex geometries (some England/Wales National Landscape boundaries run to
 * thousands of points) went from ~1.3s to ~70ms.
 */
export async function findConsulteeAreasNear(
	dbClient: PrismaClient,
	geometry: Geometry,
	radiusMetres: number,
	consulteeCategories?: string[],
	excludeCategories?: string[]
): Promise<ConsulteeAreaMatch[]> {
	const rows = await queryAreasNear<ConsulteeAreaRow>(
		dbClient,
		selectColumns,
		geometry,
		radiusMetres,
		consulteeCategories,
		excludeCategories
	);
	return rows.map((row) => ({ feature: rowToFeature(row), distanceMetres: row.distanceMetres }));
}

/**
 * findConsulteeAreasNear without each area's geometry - for a listing that only shows names,
 * categories and distances. Geometry is by far the largest part of a row (a county or National
 * Park boundary runs to tens of KB of WKT), so a wide "everything nearby" fetch that skips it
 * moves and parses a fraction of the data.
 */
export async function findConsulteeAreaSummariesNear(
	dbClient: PrismaClient,
	geometry: Geometry,
	radiusMetres: number,
	consulteeCategories?: string[],
	excludeCategories?: string[]
): Promise<ConsulteeAreaSummaryMatch[]> {
	const rows = await queryAreasNear<ConsulteeAreaSummaryRow>(
		dbClient,
		summaryColumns,
		geometry,
		radiusMetres,
		consulteeCategories,
		excludeCategories
	);
	return rows.map((row) => ({ feature: rowToSummary(row), distanceMetres: row.distanceMetres }));
}

async function queryAreasNear<Row>(
	dbClient: PrismaClient,
	columns: Prisma.Sql,
	geometry: Geometry,
	radiusMetres: number,
	consulteeCategories?: string[],
	excludeCategories?: string[]
): Promise<(Row & { distanceMetres: number })[]> {
	const wkt = geometryToWkt(geometry);
	const categoryFilter =
		consulteeCategories && consulteeCategories.length > 0
			? Prisma.sql`AND consulteeCategory IN (${Prisma.join(consulteeCategories)})`
			: Prisma.empty;
	// NULL-safe: a plain "NOT IN" would also drop any row with no category at all, since
	// `NULL NOT IN (...)` is unknown, not true - that's a real row, not a pathological one, and
	// should still show up here
	const excludeFilter =
		excludeCategories && excludeCategories.length > 0
			? Prisma.sql`AND (consulteeCategory IS NULL OR consulteeCategory NOT IN (${Prisma.join(excludeCategories)}))`
			: Prisma.empty;
	return withDeadlockRetry(
		() =>
			dbClient.$queryRaw<(Row & { distanceMetres: number })[]>`
			SELECT ${columns},
				geometrySimplified.STDistance(geography::STGeomFromText(${wkt}, 4326)) AS distanceMetres
			FROM consultee_area WITH (INDEX(consultee_area_geometry_simplified_sidx))
			WHERE geometrySimplified.STDistance(geography::STGeomFromText(${wkt}, 4326)) <= ${radiusMetres + DISTANCE_MARGIN_METRES}
				${categoryFilter}
				${excludeFilter}
			ORDER BY distanceMetres
		`
	);
}

/**
 * Simplify `geometry` the same way consultee areas' `geometrySimplified` is (see
 * SIMPLIFY_TOLERANCE_METRES) - done once per ruleset run, then used for every query in it. Detailed
 * site boundaries are where most of a run's time went: one 0.3 km² site had 2,536 points, mostly
 * under a metre apart.
 */
export async function simplifyGeometry(dbClient: PrismaClient, geometry: Geometry): Promise<Geometry> {
	const [row] = await withDeadlockRetry(
		() => dbClient.$queryRaw<{ wkt: string }[]>`
			SELECT geography::STGeomFromText(${geometryToWkt(geometry)}, 4326)
				.Reduce(${SIMPLIFY_TOLERANCE_METRES}).MakeValid().STAsText() AS wkt
		`
	);
	return wktToGeometry(row.wkt);
}

/**
 * `geometry` grown outwards by `metres` (to within 1m). "Within n metres of X" then becomes "intersects
 * X grown by n" - a much cheaper check against detailed shapes, because an intersects test can stop
 * at the first point of contact where a distance calculation can't (for a 180km route, a host lookup
 * went from timing out at 15s to ~2s).
 */
export async function growGeometry(dbClient: PrismaClient, geometry: Geometry, metres: number): Promise<Geometry> {
	const [row] = await withDeadlockRetry(
		() => dbClient.$queryRaw<{ wkt: string }[]>`
			SELECT geography::STGeomFromText(${geometryToWkt(geometry)}, 4326).BufferWithTolerance(${metres}, 1, 0).STAsText() AS wkt
		`
	);
	return wktToGeometry(row.wkt);
}

// SQL Server caps a single statement at 2,100 parameters
const GEOMETRY_LOOKUP_BATCH_SIZE = 1000;

/**
 * Approximate distance (simplified shapes) from `geometry` to specific consultee areas by id. Ids with
 * no matching row are absent.
 */
export async function getConsulteeAreaDistances(
	dbClient: PrismaClient,
	geometry: Geometry,
	ids: string[]
): Promise<Map<string, number>> {
	const wkt = geometryToWkt(geometry);
	const distances = new Map<string, number>();
	for (let i = 0; i < ids.length; i += GEOMETRY_LOOKUP_BATCH_SIZE) {
		const batch = ids.slice(i, i + GEOMETRY_LOOKUP_BATCH_SIZE);
		const rows = await withDeadlockRetry(
			() => dbClient.$queryRaw<{ id: string; distanceMetres: number }[]>`
				SELECT id, geometrySimplified.STDistance(geography::STGeomFromText(${wkt}, 4326)) AS distanceMetres
				FROM consultee_area WHERE id IN (${Prisma.join(batch)})
			`
		);
		for (const row of rows) {
			distances.set(row.id, row.distanceMetres);
		}
	}
	return distances;
}

/** Fetch the geometries of specific consultee areas by id. Ids with no matching row are absent. */
export async function getConsulteeAreaGeometries(
	dbClient: PrismaClient,
	ids: string[]
): Promise<Map<string, Geometry>> {
	const geometries = new Map<string, Geometry>();
	for (let i = 0; i < ids.length; i += GEOMETRY_LOOKUP_BATCH_SIZE) {
		const batch = ids.slice(i, i + GEOMETRY_LOOKUP_BATCH_SIZE);
		const rows = await withDeadlockRetry(
			() => dbClient.$queryRaw<{ id: string; geometryWkt: string }[]>`
				SELECT id, geometry.STAsText() AS geometryWkt FROM consultee_area WHERE id IN (${Prisma.join(batch)})
			`
		);
		for (const row of rows) {
			geometries.set(row.id, wktToGeometry(row.geometryWkt));
		}
	}
	return geometries;
}

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

/**
 * Find consultee areas of `matchingCategories` that share a border with a `hostCategory` area
 * the site is in - e.g. "neighbouring parishes of the parish the site sits in".
 *
 * Takes the site already grown by DISTANCE_MARGIN_METRES (see growGeometry), so a host is any
 * `hostCategory` area that intersects it - i.e. within the margin of the site. A neighbour is any
 * matching area within BORDERING_TOLERANCE_METRES of a host - "touching" exactly would miss real
 * neighbours whose boundaries come from different sources and don't quite meet. The host itself is
 * excluded by id. Both are intersects checks against pre-grown shapes, on simplified geometry:
 * unlike a distance check, an intersects test stops at the first point of contact, which is what
 * keeps this fast for long routes crossing a hundred parishes or large council boundaries.
 *
 * Returns the matching areas without a distance - matching isn't about distance from the site, and
 * measuring it here would repeat for every host (see runRuleset, which measures it once).
 *
 * Two round trips, not one: a single query comparing `candidate.geometry` with `host.geometry`
 * column-to-column can't use the spatial index (it needs a constant on one side), so it degrades
 * to a near full-table scan - confirmed by a real 15s+ timeout on this project's own reference
 * data. Fetching the host areas first, then querying with each one's geometry as a parameter,
 * keeps both queries on the indexed `STIntersects(column, constant)` path.
 */
export async function findConsulteeAreasBordering(
	dbClient: PrismaClient,
	siteWithinMargin: Geometry,
	hostCategory: string,
	matchingCategories: string[]
): Promise<ConsulteeAreaFeature[]> {
	if (matchingCategories.length === 0) {
		return [];
	}
	const wkt = geometryToWkt(siteWithinMargin);

	return withDeadlockRetry(async () => {
		// each host comes back already grown by the bordering tolerance (to within 1m, well inside its
		// slack) - Somerset's neighbours by distance took ~930ms, by intersects with it grown ~220ms
		const hosts = await dbClient.$queryRaw<{ id: string; grownHostWkt: string }[]>`
			SELECT id, geometrySimplified.BufferWithTolerance(${BORDERING_TOLERANCE_METRES}, 1, 0).STAsText() AS grownHostWkt
			FROM consultee_area WITH (INDEX(consultee_area_geometry_simplified_sidx))
			WHERE consulteeCategory = ${hostCategory}
				AND geometrySimplified.STIntersects(geography::STGeomFromText(${wkt}, 4326)) = 1
		`;

		const matchesById = new Map<string, ConsulteeAreaRow>();
		for (const host of hosts) {
			const rows = await dbClient.$queryRaw<ConsulteeAreaRow[]>`
				SELECT ${selectColumns}
				FROM consultee_area WITH (INDEX(consultee_area_geometry_simplified_sidx))
				WHERE consulteeCategory IN (${Prisma.join(matchingCategories)})
					AND id <> CAST(${host.id} AS UNIQUEIDENTIFIER)
					AND geometrySimplified.STIntersects(geography::STGeomFromText(${host.grownHostWkt}, 4326)) = 1
			`;
			for (const row of rows) {
				matchesById.set(row.id, row);
			}
		}

		return [...matchesById.values()].map(rowToFeature);
	});
}

/**
 * Find consultee areas that intersect `geometry`.
 */
export async function findConsulteeAreasIntersecting(
	dbClient: PrismaClient,
	geometry: Geometry
): Promise<ConsulteeAreaFeatureCollection> {
	const wkt = geometryToWkt(geometry);
	const rows = await withDeadlockRetry(
		() => dbClient.$queryRaw<ConsulteeAreaRow[]>`
			SELECT ${selectColumns}
			FROM consultee_area
			WHERE geometry.STIntersects(geography::STGeomFromText(${wkt}, 4326)) = 1
		`
	);
	return { type: 'FeatureCollection', features: rows.map(rowToFeature) };
}
