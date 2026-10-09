import type { PrismaClient } from '../client/client.ts';
import { Prisma } from '../client/client.ts';
import { withDeadlockRetry } from './db-retry.ts';
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

export interface LoadOptions {
	/** Rows per round trip - see the equivalent option on loadConsulteeAreas for why this exists. */
	batchSize?: number;
	onProgress?: (loaded: number, total: number) => void;
}

const DEFAULT_LOAD_BATCH_SIZE = 200;

/**
 * Upsert (by id) every feature in `featureCollection` into case_boundary, `batchSize` rows per
 * round trip via `OPENJSON` rather than one round trip per row - see loadConsulteeAreas for the
 * same technique and why it matters once this holds a real, large dataset. Safe to re-run over
 * data that's already there.
 */
export async function loadCaseBoundaries(
	dbClient: PrismaClient,
	featureCollection: CaseBoundaryFeatureCollection,
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
				caseReference: feature.properties.caseReference,
				caseName: feature.properties.caseName,
				fileName: feature.properties.fileName ?? null,
				receivedDate: feature.properties.receivedDate ? feature.properties.receivedDate.toISOString() : null,
				acceptance: feature.properties.acceptance ?? null,
				// pre-stringified rather than nested JSON - OPENJSON's WITH clause extracts a
				// declared NVARCHAR column as a scalar string, not a nested object
				metadata: JSON.stringify(feature.properties.metadata ?? {})
			}))
		);

		await dbClient.$executeRaw`
			MERGE INTO case_boundary AS target
			USING (
				SELECT
					id,
					geometryType,
					-- .MakeValid() is a no-op for already-valid geometry, and repairs minor
					-- self-intersections real-world boundary simplification introduces
					geography::STGeomFromText(wkt, 4326).MakeValid() AS geometry,
					caseReference,
					caseName,
					fileName,
					receivedDate,
					acceptance,
					metadata
				FROM OPENJSON(${batchJson})
				WITH (
					id UNIQUEIDENTIFIER '$.id',
					geometryType NVARCHAR(50) '$.geometryType',
					-- NVARCHAR(MAX) here (not JSON_VALUE, which silently returns NULL past 4000
					-- characters) - real geometry WKT routinely exceeds that
					wkt NVARCHAR(MAX) '$.wkt',
					caseReference NVARCHAR(50) '$.caseReference',
					caseName NVARCHAR(500) '$.caseName',
					fileName NVARCHAR(500) '$.fileName',
					receivedDate DATETIME2 '$.receivedDate',
					acceptance NVARCHAR(50) '$.acceptance',
					metadata NVARCHAR(MAX) '$.metadata'
				)
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

		onProgress?.(Math.min(i + batchSize, features.length), features.length);
	}
	return features.length;
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

	const rows = await withDeadlockRetry(() =>
		limit === undefined
			? dbClient.$queryRaw<CaseBoundaryRow[]>`SELECT ${selectColumns} FROM case_boundary`
			: dbClient.$queryRaw<CaseBoundaryRow[]>`
					SELECT ${selectColumns} FROM case_boundary
					-- SQL Server requires ORDER BY for OFFSET/FETCH; the primary key gives a stable
					-- order without needing a table-specific column
					ORDER BY id OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
				`
	);

	return { type: 'FeatureCollection', features: rows.map(rowToFeature) };
}

/**
 * Look up a single case boundary by id. Returns `null` rather than throwing when the id is
 * well-formed but doesn't match any row - a genuine "not found", not an error.
 */
export async function getCaseBoundaryById(dbClient: PrismaClient, id: string): Promise<CaseBoundaryFeature | null> {
	const rows = await withDeadlockRetry(
		() => dbClient.$queryRaw<CaseBoundaryRow[]>`
			SELECT ${selectColumns} FROM case_boundary WHERE id = CAST(${id} AS UNIQUEIDENTIFIER)
		`
	);
	return rows[0] ? rowToFeature(rows[0]) : null;
}

/**
 * A case boundary without its geometry - for the (common) pages that only ever show a
 * reference/name/date and would otherwise pay for fetching and WKT-parsing a geometry that's
 * never used. Some real boundaries are large (complex multi-part polygons), so this isn't just a
 * theoretical saving on the app's highest-traffic pages (home page search, the ruleset picker).
 */
export interface CaseBoundarySummary {
	id: string;
	reference: string;
	caseName: string;
	receivedDate: Date | null;
	/** Project stage placeholder (e.g. Scoping / Acceptance) - no current data source populates it. */
	acceptance: string | null;
}

const summaryColumns = Prisma.raw('id, caseReference, caseName, receivedDate, acceptance');

function rowToSummary(row: {
	id: string;
	caseReference: string;
	caseName: string;
	receivedDate: Date | null;
	acceptance: string | null;
}): CaseBoundarySummary {
	return {
		id: row.id,
		reference: row.caseReference,
		caseName: row.caseName,
		receivedDate: row.receivedDate,
		acceptance: row.acceptance
	};
}

/**
 * Look up a single case boundary by id, without its geometry - see {@link CaseBoundarySummary}.
 * Returns `null` rather than throwing when the id is well-formed but doesn't match any row.
 */
export async function getCaseBoundarySummaryById(
	dbClient: PrismaClient,
	id: string
): Promise<CaseBoundarySummary | null> {
	const rows = await withDeadlockRetry(
		() => dbClient.$queryRaw<
			{ id: string; caseReference: string; caseName: string; receivedDate: Date | null; acceptance: string | null }[]
		>`
			SELECT ${summaryColumns} FROM case_boundary WHERE id = CAST(${id} AS UNIQUEIDENTIFIER)
		`
	);
	return rows[0] ? rowToSummary(rows[0]) : null;
}

/**
 * One shapefile held for a case: the same project (one caseReference) can have several boundary
 * submissions over time, each imported from its own file - see the comment in
 * seed/geojson-import.ts's toCaseBoundary. The shapefile picker lists these so the user can run
 * a different submission for the same project.
 */
export interface CaseBoundaryFile {
	id: string;
	fileName: string | null;
	receivedDate: Date | null;
}

/**
 * List every stored shapefile for one project - all case_boundary rows sharing `caseReference`,
 * most recently received first (NULL dates sort last under DESC). Each row's id is the caseId a
 * map/report page needs, so picking a file is just navigating to that id.
 */
export async function listCaseBoundaryFiles(
	dbClient: PrismaClient,
	caseReference: string
): Promise<CaseBoundaryFile[]> {
	return withDeadlockRetry(
		() => dbClient.$queryRaw<CaseBoundaryFile[]>`
			SELECT id, fileName, receivedDate
			FROM case_boundary
			WHERE caseReference = ${caseReference}
			ORDER BY receivedDate DESC, id
		`
	);
}

export interface SearchOptions {
	query?: string;
	limit?: number;
	offset?: number;
}

export interface SearchResult {
	features: CaseBoundarySummary[];
	total: number;
}

/**
 * Search case boundaries by name/reference (case-insensitive substring match), paginated.
 * Fetches the matching page and the total match count in a single round trip via
 * `COUNT(*) OVER()`, rather than a separate COUNT(*) query. Returns summaries, not full features
 * with geometry - see {@link CaseBoundarySummary} - since every current caller is a results list
 * that never renders a boundary's shape.
 *
 * A leading-wildcard LIKE can't use a plain index - fine while the table is small, but consider
 * a full-text index (or a proper search service) once it holds a large, real dataset.
 */
export async function searchCaseBoundaries(dbClient: PrismaClient, options: SearchOptions = {}): Promise<SearchResult> {
	const { query, limit = 25, offset = 0 } = options;
	const likePattern = query?.trim() ? `%${query.trim()}%` : '%';

	const rows = await withDeadlockRetry(
		() => dbClient.$queryRaw<
			{
				id: string;
				caseReference: string;
				caseName: string;
				receivedDate: Date | null;
				acceptance: string | null;
				totalCount: bigint;
			}[]
		>`
			SELECT ${summaryColumns}, COUNT(*) OVER() AS totalCount
			FROM case_boundary
			WHERE caseName LIKE ${likePattern} OR caseReference LIKE ${likePattern}
			ORDER BY caseName
			OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
		`
	);

	let total = rows[0] ? Number(rows[0].totalCount) : 0;

	// An out-of-range offset returns no rows, so the window count is lost with them. Count matches
	// directly so callers can still tell "no results" apart from "page beyond the last one".
	if (total === 0 && offset > 0) {
		const countRows = await withDeadlockRetry(
			() => dbClient.$queryRaw<{ total: bigint }[]>`
				SELECT COUNT(*) AS total FROM case_boundary
				WHERE caseName LIKE ${likePattern} OR caseReference LIKE ${likePattern}
			`
		);
		total = countRows[0] ? Number(countRows[0].total) : 0;
	}

	return {
		features: rows.map(rowToSummary),
		total
	};
}
