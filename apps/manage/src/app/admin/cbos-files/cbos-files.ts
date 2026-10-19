import { fetchWithTimeout } from '@planning-inspectorate/core/util';
import type { CbosFunctionOptions } from '../import-from-cbos/cbos-boundaries.ts';

/**
 * Every file in CBOS's GIS Shapefiles folders, every version, as the Python function lists them
 * (apps/function-python/cbos/gis_files.py) - and which of them the boundary import reads, so a
 * case missing from the import can be traced to why.
 */

export const GIS_SHAPEFILES_FOLDER = 'GIS Shapefiles';
export const GEOJSON_MIME = 'application/geo+json';
const ZIP_MIMES = ['application/zip', 'application/x-zip-compressed'];

export interface CbosGisFile {
	documentGuid: string;
	version: number;
	latestVersion: number | null;
	caseReference: string | null;
	caseTitle: string | null;
	folder: string;
	fileName: string | null;
	originalFileName: string | null;
	mime: string | null;
	size: number | null;
	publishedStatus: string | null;
	createdAt: string | null;
	blobContainer: string | null;
	blobPath: string | null;
}

export interface CbosGisFileListing {
	casesWithReference: number;
	casesWithGisFolder: number;
	files: CbosGisFile[];
}

/** What a file's blob holds, as the function read it. */
export interface CbosGisFileContent {
	bytes: number;
	kind: 'zip' | 'geojson' | 'json' | 'text' | 'binary';
	problem?: string;
	entries?: { name: string; size: number }[];
	type?: string | null;
	crs?: unknown;
	featureCount?: number;
	geometryTypes?: string[];
	firstPosition?: number[] | null;
	firstFeatureProperties?: unknown;
	preview?: string;
}

export interface CbosGisFileDetail {
	file: CbosGisFile;
	/** Every live version of the file's document, oldest first. */
	versions: CbosGisFile[];
	/** Why the blob couldn't be read, when it couldn't. */
	problem?: string;
	content?: CbosGisFileContent;
}

/** A failed call to the function, with its status - 404 when CBOS has no such file. */
export class CbosFunctionError extends Error {
	readonly status?: number;

	constructor(message: string, status?: number) {
		super(message);
		this.status = status;
	}
}

const LIST_TIMEOUT_MS = 60_000;
// the function downloads the whole blob - a shapefile ZIP can be tens of megabytes
const FILE_TIMEOUT_MS = 120_000;

async function getJson(options: CbosFunctionOptions, path: string, timeoutMs: number): Promise<unknown> {
	if (!options.pythonFunctionUrl) {
		throw new CbosFunctionError('the Python function is not configured');
	}
	// PYTHON_FUNCTION_URL names the consultee-areas route, so CBOS routes are its siblings under `/api/`
	const response = await fetchWithTimeout(
		new URL(path, options.pythonFunctionUrl).toString(),
		{ timeoutMs },
		{ headers: options.apiKey ? { 'x-api-key': options.apiKey } : undefined }
	);
	const body = (await response.json().catch(() => ({}))) as { error?: unknown };
	if (!response.ok) {
		const detail = typeof body.error === 'string' ? `: ${body.error}` : '';
		throw new CbosFunctionError(
			`the Python function responded with status ${response.status}${detail}`,
			response.status
		);
	}
	return body;
}

export async function listCbosGisFiles(options: CbosFunctionOptions): Promise<CbosGisFileListing> {
	const body = (await getJson(options, 'cbos/gis-files', LIST_TIMEOUT_MS)) as Partial<CbosGisFileListing>;
	if (!Array.isArray(body.files)) {
		throw new CbosFunctionError('the Python function returned an unexpected file list');
	}
	return body as CbosGisFileListing;
}

export async function readCbosGisFile(
	options: CbosFunctionOptions,
	documentGuid: string,
	version: number
): Promise<CbosGisFileDetail> {
	const path = `cbos/gis-files/${encodeURIComponent(documentGuid)}/${version}`;
	const body = (await getJson(options, path, FILE_TIMEOUT_MS)) as Partial<CbosGisFileDetail>;
	if (!body.file || !Array.isArray(body.versions)) {
		throw new CbosFunctionError('the Python function returned an unexpected file');
	}
	return body as CbosGisFileDetail;
}

export const isZip = (file: Pick<CbosGisFile, 'mime'>) => ZIP_MIMES.includes(file.mime ?? '');
export const isGeoJson = (file: Pick<CbosGisFile, 'mime'>) => file.mime === GEOJSON_MIME;
const inGisFolder = (file: CbosGisFile) => file.folder === GIS_SHAPEFILES_FOLDER;
export const fileKey = (file: Pick<CbosGisFile, 'documentGuid' | 'version'>) => `${file.documentGuid}/${file.version}`;
const caseKey = (file: CbosGisFile) => file.caseReference ?? '(no case reference)';

/**
 * The versions the boundary import reads: each document's newest GeoJSON version, in a GIS
 * Shapefiles folder, on a case with a reference - as cbos/boundaries.py selects them.
 */
export function filesTheImportReads(files: CbosGisFile[]): Set<string> {
	const newest = new Map<string, CbosGisFile>();
	for (const file of files) {
		if (isGeoJson(file) && inGisFolder(file) && file.caseReference) {
			const current = newest.get(file.documentGuid);
			if (!current || file.version > current.version) {
				newest.set(file.documentGuid, file);
			}
		}
	}
	return new Set([...newest.values()].map(fileKey));
}

export interface CbosGisSummary {
	casesWithReference: number;
	casesWithGisFolder: number;
	casesWithFilesInGisFolder: number;
	casesTheImportReads: number;
	casesWithOnlyUnconvertedZips: number;
	casesWithGeoJsonElsewhere: number;
	/** Documents in GIS Shapefiles folders with a ZIP but no GeoJSON version, by their latest version's status. */
	unconvertedZipsByStatus: { status: string; documents: number }[];
}

/** Where the cases drop out between CBOS and the import. */
export function summarise(listing: CbosGisFileListing, read = filesTheImportReads(listing.files)): CbosGisSummary {
	const gisFiles = listing.files.filter(inGisFolder);
	const casesRead = new Set(listing.files.filter((file) => read.has(fileKey(file))).map(caseKey));

	const documents = new Map<string, CbosGisFile[]>();
	for (const file of gisFiles) {
		documents.set(file.documentGuid, [...(documents.get(file.documentGuid) ?? []), file]);
	}
	const unconverted = [...documents.values()].filter((versions) => versions.some(isZip) && !versions.some(isGeoJson));
	const statuses = new Map<string, number>();
	for (const versions of unconverted) {
		const latest = versions.reduce((a, b) => (b.version > a.version ? b : a));
		const status = latest.publishedStatus ?? '(none)';
		statuses.set(status, (statuses.get(status) ?? 0) + 1);
	}
	const casesWithZips = new Set(unconverted.map((versions) => caseKey(versions[0])));

	return {
		casesWithReference: listing.casesWithReference,
		casesWithGisFolder: listing.casesWithGisFolder,
		casesWithFilesInGisFolder: new Set(gisFiles.map(caseKey)).size,
		casesTheImportReads: casesRead.size,
		casesWithOnlyUnconvertedZips: [...casesWithZips].filter((key) => !casesRead.has(key)).length,
		casesWithGeoJsonElsewhere: new Set(
			listing.files.filter((file) => isGeoJson(file) && !inGisFolder(file)).map(caseKey)
		).size,
		unconvertedZipsByStatus: [...statuses]
			.map(([status, count]) => ({ status, documents: count }))
			.sort((a, b) => b.documents - a.documents || a.status.localeCompare(b.status))
	};
}

// the parts of a shapefile: CBOS can't convert one without the first three, and only reprojects
// it to longitude and latitude when it has a .prj
const SHAPEFILE_PARTS = ['.shp', '.shx', '.dbf', '.prj'];

/** The shapefile parts a ZIP's listing is missing. */
export function missingShapefileParts(entries: { name: string }[]): string[] {
	const names = entries.map((entry) => entry.name.toLowerCase());
	return SHAPEFILE_PARTS.filter((part) => !names.some((name) => name.endsWith(part)));
}

/** Whether a position reads as longitude and latitude, rather than British National Grid metres. */
export function isLongitudeLatitude(position: number[] | null | undefined): boolean | undefined {
	if (!position || position.length < 2) {
		return undefined;
	}
	const [lon, lat] = position;
	return Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
}
