import type { PrismaClient } from '@pins/identify-consultees-database/src/client/client.ts';
import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import { loadCaseBoundaries } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { Geometry, PolygonGeometry, Position } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';
import { toCaseBoundary } from '@pins/identify-consultees-database/src/seed/geojson-import.ts';
import { fetchWithTimeout } from '@planning-inspectorate/core/util';

/**
 * Case boundaries from CBOS (the IDAS back office). Only the Python function can reach CBOS
 * (infrastructure/idas-back-office.tf), so it lists CBOS's boundary files and returns each one's
 * GeoJSON (apps/function-python/cbos/boundaries.py); this side saves them to case_boundary with
 * the same loader, and the same ids, as the file import.
 */

export interface CbosBoundaryFile {
	documentGuid: string;
	version: number;
	caseReference: string;
	caseTitle: string | null;
	fileName: string | null;
	createdAt: string | null;
	/** The case's stage now, as CBOS stores it (pre_examination) - absent from an older function. */
	caseStage?: string | null;
}

/**
 * CBOS's case stages - its state machine's - labelled as its own pages label them. Any other (a
 * draft case's) shows none.
 */
export const CASE_STAGE_LABELS: ReadonlyMap<string, string> = new Map([
	['pre_application', 'Pre-Application'],
	['acceptance', 'Acceptance'],
	['pre_examination', 'Pre-Examination'],
	['examination', 'Examination'],
	['recommendation', 'Recommendation'],
	['decision', 'Decision'],
	['post_decision', 'Post-Decision'],
	['withdrawn', 'Withdrawn']
]);

function caseStageLabel(stage: string | null | undefined): string | null {
	return (stage && CASE_STAGE_LABELS.get(stage)) ?? null;
}

interface CbosFeature {
	geometry: Geometry | null;
	properties?: Record<string, unknown> | null;
}

export interface CbosFeatureCollection {
	type: 'FeatureCollection';
	features: CbosFeature[];
}

export interface CbosFunctionOptions {
	pythonFunctionUrl: string | undefined;
	apiKey: string | undefined;
}

export interface CbosImportFailure {
	caseReference: string;
	fileName: string | null;
	reason: string;
}

export interface CbosImportResult {
	filesFound: number;
	imported: number;
	/** How many cases the imported boundaries are for. */
	casesImported: number;
	failures: CbosImportFailure[];
}

const LIST_TIMEOUT_MS = 60_000;
// the largest boundaries are tens of megabytes of coordinates
const FILE_TIMEOUT_MS = 120_000;
// enough to overlap the function's database and blob round trips without crowding it
const FETCH_CONCURRENCY = 4;

function functionUrl(pythonFunctionUrl: string, path: string): string {
	// PYTHON_FUNCTION_URL names the consultee-areas route, so CBOS routes are its siblings under
	// the same `/api/` - as run-ruleset is (see ruleset-runner.ts)
	return new URL(path, pythonFunctionUrl).toString();
}

async function getJson(options: CbosFunctionOptions, path: string, timeoutMs: number): Promise<unknown> {
	if (!options.pythonFunctionUrl) {
		throw new Error('PYTHON_FUNCTION_URL is not configured');
	}
	const response = await fetchWithTimeout(
		functionUrl(options.pythonFunctionUrl, path),
		{ timeoutMs },
		{ headers: options.apiKey ? { 'x-api-key': options.apiKey } : undefined }
	);
	if (!response.ok) {
		throw new Error(`Python function ${path} responded with status ${response.status}`);
	}
	return response.json();
}

export async function listCbosBoundaryFiles(options: CbosFunctionOptions): Promise<CbosBoundaryFile[]> {
	const body = (await getJson(options, 'cbos/boundary-files', LIST_TIMEOUT_MS)) as { files?: CbosBoundaryFile[] };
	if (!Array.isArray(body.files)) {
		throw new Error('Python function returned an unexpected boundary file list');
	}
	return body.files;
}

export async function fetchCbosBoundaryGeoJson(
	options: CbosFunctionOptions,
	file: CbosBoundaryFile
): Promise<CbosFeatureCollection> {
	const path = `cbos/boundary-files/${encodeURIComponent(file.documentGuid)}/${file.version}`;
	const body = (await getJson(options, path, FILE_TIMEOUT_MS)) as CbosFeatureCollection;
	if (body?.type !== 'FeatureCollection' || !Array.isArray(body.features)) {
		throw new Error('Python function returned something other than a GeoJSON FeatureCollection');
	}
	return body;
}

/**
 * One geometry for a boundary file. A shapefile often holds several polygons (a site and its
 * access routes, say); case_boundary keeps one row per file, so they become one MultiPolygon.
 * Overlaps are fine: the loader runs MakeValid() on every geometry.
 */
export function combineGeometries(geometries: Geometry[]): Geometry {
	if (geometries.length === 1) {
		return geometries[0];
	}
	const polygons: PolygonGeometry['coordinates'][] = [];
	for (const geometry of geometries) {
		if (geometry.type === 'Polygon') {
			polygons.push(geometry.coordinates);
		} else if (geometry.type === 'MultiPolygon') {
			polygons.push(...geometry.coordinates);
		} else {
			return { type: 'GeometryCollection', geometries };
		}
	}
	return { type: 'MultiPolygon', coordinates: polygons };
}

function positions(geometry: Geometry): Position[] {
	switch (geometry.type) {
		case 'Point':
			return [geometry.coordinates];
		case 'MultiPoint':
		case 'LineString':
			return geometry.coordinates;
		case 'MultiLineString':
		case 'Polygon':
			return geometry.coordinates.flat();
		case 'MultiPolygon':
			return geometry.coordinates.flat(2);
		case 'GeometryCollection':
			return geometry.geometries.flatMap(positions);
	}
}

/**
 * CBOS only reprojects a shapefile to WGS84 when its ZIP includes a .prj file, and accepts one
 * without - leaving British National Grid metres where longitude and latitude belong. SQL Server
 * would reject those, failing every row in the batch, so the file is turned away on its own.
 */
function assertLongitudeLatitude(geometry: Geometry): void {
	const outOfRange = positions(geometry).some(([lon, lat]) => !(Math.abs(lon) <= 180 && Math.abs(lat) <= 90));
	if (outOfRange) {
		throw new Error("the coordinates aren't longitude and latitude (the shapefile ZIP may have no .prj file)");
	}
}

/**
 * The case_boundary row for one CBOS boundary file. Its id comes from the case reference and file
 * name, as the file import's does (toCaseBoundary), so a boundary already loaded from a file is
 * updated rather than duplicated. The project name is CBOS's current case title, not the one
 * stamped on the GeoJSON when it was converted, so a renamed case is picked up - and its stage,
 * the case's stage now, so each import brings it up to date.
 */
export function toCaseBoundaryFromCbos(file: CbosBoundaryFile, collection: CbosFeatureCollection): CaseBoundaryFeature {
	const geometries = collection.features.flatMap((feature) => (feature.geometry ? [feature.geometry] : []));
	if (geometries.length === 0) {
		throw new Error('the GeoJSON has no geometry');
	}
	const geometry = combineGeometries(geometries);
	assertLongitudeLatitude(geometry);
	const stamped = collection.features[0]?.properties ?? {};
	const boundary = toCaseBoundary({
		geometry,
		properties: {
			caseReference: file.caseReference,
			projectName: file.caseTitle ?? stamped.projectName ?? file.caseReference,
			fileName: file.fileName ?? stamped.fileName ?? `${file.documentGuid}.geojson`,
			receivedDate: stamped.receivedDate ?? file.createdAt
		}
	});
	return {
		...boundary,
		properties: {
			...boundary.properties,
			acceptance: caseStageLabel(file.caseStage),
			metadata: { source: 'cbos', cbosDocumentGuid: file.documentGuid, cbosVersion: file.version }
		}
	};
}

/**
 * The files with names their case_boundary rows can tell apart. Every version of a boundary CBOS
 * converted is kept, so a case can have two files of one name - a ZIP replaced by another of the
 * same name, or two documents named alike. The newest keeps its name, and so the row a file import
 * made for it; each older one is named for its version as well ("site.geojson (version 2)").
 */
export function distinctFileNames(files: CbosBoundaryFile[]): CbosBoundaryFile[] {
	const newestFirst = files.toSorted(
		(a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.version - a.version
	);
	const taken = new Set<string>();
	const renamed = new Map<CbosBoundaryFile, CbosBoundaryFile>();
	for (const file of newestFirst) {
		if (!file.fileName) {
			continue;
		}
		const key = (name: string) => `${file.caseReference}\n${name}`;
		let fileName = file.fileName;
		if (taken.has(key(fileName))) {
			fileName = `${file.fileName} (version ${file.version})`;
		}
		if (taken.has(key(fileName))) {
			fileName = `${file.fileName} (version ${file.version}, ${file.documentGuid.slice(0, 8)})`;
		}
		taken.add(key(fileName));
		renamed.set(file, fileName === file.fileName ? file : { ...file, fileName });
	}
	return files.map((file) => renamed.get(file) ?? file);
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export interface CbosImportDependencies {
	listFiles: typeof listCbosBoundaryFiles;
	fetchGeoJson: typeof fetchCbosBoundaryGeoJson;
	load: typeof loadCaseBoundaries;
}

const DEFAULT_DEPENDENCIES: CbosImportDependencies = {
	listFiles: listCbosBoundaryFiles,
	fetchGeoJson: fetchCbosBoundaryGeoJson,
	load: loadCaseBoundaries
};

/**
 * Save every CBOS boundary file - every version of each - to case_boundary. It merges: rows are upserted by id and nothing is
 * deleted, so boundaries loaded from elsewhere stay. A file that can't be fetched or read is
 * reported and skipped rather than failing the rest; failing to list the files rejects.
 */
export async function importCaseBoundariesFromCbos(
	db: PrismaClient,
	options: CbosFunctionOptions,
	dependencies: CbosImportDependencies = DEFAULT_DEPENDENCIES
): Promise<CbosImportResult> {
	const files = distinctFileNames(await dependencies.listFiles(options));
	const boundaries: CaseBoundaryFeature[] = [];
	const failures: CbosImportFailure[] = [];

	let next = 0;
	const worker = async () => {
		while (next < files.length) {
			const file = files[next++];
			try {
				boundaries.push(toCaseBoundaryFromCbos(file, await dependencies.fetchGeoJson(options, file)));
			} catch (error) {
				failures.push({ caseReference: file.caseReference, fileName: file.fileName, reason: describe(error) });
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, files.length) }, worker));

	const imported =
		boundaries.length > 0 ? await dependencies.load(db, { type: 'FeatureCollection', features: boundaries }) : 0;
	const casesImported = new Set(boundaries.map((boundary) => boundary.properties.caseReference)).size;
	return { filesFound: files.length, imported, casesImported, failures };
}
