import type { PrismaClient } from '@pins/identify-consultees-database/src/client/client.ts';
import { createHash } from 'node:crypto';
import type { CaseBoundaryFeature } from '../geospatial/case-boundaries.ts';
import { loadCaseBoundaries } from '../geospatial/case-boundaries.ts';
import type { ConsulteeAreaFeature, LoadOptions } from '../geospatial/consultee-areas.ts';
import { loadConsulteeAreas } from '../geospatial/consultee-areas.ts';
import type { Geometry } from '../geospatial/wkt.ts';
import { streamFeatures } from './feature-stream.ts';
import {
	consulteeCategoryFor,
	datasetCode,
	REFERENCE_DATA_CONFIG,
	type ReferenceDataConfig
} from './reference-data.ts';

/**
 * Shared logic for importing the two GeoJSON sources this project loads: reference/consultee
 * area data (railways, police force areas, etc.) and project/case boundary data (CBOS). Used both
 * for the small local dev sample (see data-dev.ts) and for a real, large dataset via import-cli.ts
 * - the shape is the same source format either way, just more rows.
 */

interface RawFeature {
	geometry: Geometry;
	properties: Record<string, unknown>;
}

/**
 * A stable id derived from `seed`, so re-running an import updates the same rows instead of
 * inserting duplicates each time - SQL Server's UNIQUEIDENTIFIER just needs a valid 8-4-4-4-12 hex
 * shape, it doesn't care about RFC 4122 version/variant bits.
 */
export function deterministicId(seed: string): string {
	const hash = createHash('sha256').update(seed).digest('hex');
	return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/** A property as text, or null when it's absent or blank. */
function text(value: unknown): string | null {
	return value === null || value === undefined || String(value).trim() === '' ? null : String(value).trim();
}

/** A positive whole version number, 1 when there's none. */
function version(value: unknown): number {
	const number = Number(value);
	return Number.isInteger(number) && number >= 1 ? number : 1;
}

/** A date as YYYY-MM-DD, null when there's none - a value that isn't one throws, naming the feature. */
function isoDate(value: unknown, property: string, id: string): string | null {
	if (value === null || value === undefined || String(value).trim() === '') {
		return null;
	}
	const date = /^(\d{4}-\d{2}-\d{2})(T.*)?$/.exec(String(value).trim());
	if (!date || Number.isNaN(Date.parse(date[1]))) {
		throw new Error(`Feature ${id} has ${property} "${String(value)}", which isn't a date`);
	}
	return date[1];
}

export function toConsulteeArea(
	feature: RawFeature,
	config: ReferenceDataConfig = REFERENCE_DATA_CONFIG
): ConsulteeAreaFeature {
	const props = feature.properties;

	// two source shapes: the small camelCase sample (consulteeCategory, metadata an object) and the
	// reference data export (consultee_category, snake_case). The export's category is a broad
	// group (Health, Transport...), so a feature whose id names its dataset takes that dataset's
	// category - see config/reference-data.yaml - and keeps the group as consulteeGroup. Earlier
	// exports gave metadata as a Python dict repr string, not valid JSON: it's kept as-is under
	// rawMetadata rather than risking corruption from a fragile parser
	const id = String(props.id ?? '');
	const fileCategory = (props.consulteeCategory ?? props.consultee_category) as string | undefined;
	const rawMetadata = props.metadata;
	let metadata: Record<string, unknown> = {};
	if (rawMetadata && typeof rawMetadata === 'object') {
		metadata = rawMetadata as Record<string, unknown>;
	} else if (typeof rawMetadata === 'string') {
		metadata = { rawMetadata };
	}

	const subcategory = text(props.consultee_subcategory ?? props.consulteeSubcategory);
	return {
		id: deterministicId(`consultee-area:${props.id}`),
		type: 'Feature',
		geometry: feature.geometry,
		properties: {
			sourceId: id || null,
			consulteeCategory: consulteeCategoryFor(id, fileCategory, subcategory, config) ?? null,
			consulteeGroup: datasetCode(id) === undefined ? null : (fileCategory ?? null),
			consulteeSubcategory: subcategory,
			consulteeSubcategoryDescription: text(
				props.consultee_subcategory_description ?? props.consulteeSubcategoryDescription
			),
			currentVersion: version(props.current_version ?? props.currentVersion),
			validFrom: isoDate(props.valid_from ?? props.validFrom, 'valid_from', id),
			validTo: isoDate(props.valid_to ?? props.validTo, 'valid_to', id),
			consultee: (props.consultee as string) ?? null,
			region: (props.region as string) ?? null,
			metadata
		}
	};
}

export function toCaseBoundary(feature: RawFeature): CaseBoundaryFeature {
	const props = feature.properties;
	return {
		// caseReference alone isn't a unique key for real data - the same project can have several
		// boundary submissions over time (different fileName/receivedDate for the same reference),
		// which caseReference-only ids would silently collapse into one, dropping real rows. Note:
		// this changes ids for anything already seeded under the old caseReference-only scheme
		// (harmless - it just leaves old rows alongside new ones, as already happens with
		// consultee_area's sample vs. real data; clear case_boundary first for a clean re-seed).
		id: deterministicId(`case-boundary:${props.caseReference}:${props.fileName}`),
		type: 'Feature',
		geometry: feature.geometry,
		properties: {
			caseReference: props.caseReference as string,
			caseName: props.projectName as string,
			fileName: (props.fileName as string) ?? null,
			receivedDate: props.receivedDate ? new Date(props.receivedDate as string) : null,
			metadata: {}
		}
	};
}

export type ImportType = 'consultee-areas' | 'case-boundaries';

// small enough that each delete is a short transaction on Azure SQL - a single DELETE of every row
// (some carry whole county or national-scale geometry) is one long, log-heavy transaction
export const CLEAR_BATCH_SIZE = 500;

/**
 * Delete every row from `type`'s table, a batch at a time - so an import can replace a dataset
 * rather than merge into it. The loaders upsert by id and never delete, so without this, a source
 * whose ids changed, or that dropped areas, leaves the old rows behind as duplicates or stale
 * consultees. Neither table has foreign keys, so nothing else needs clearing with it.
 */
export async function clearExistingRows(dbClient: PrismaClient, type: ImportType): Promise<number> {
	let total = 0;
	for (;;) {
		const deleted =
			type === 'consultee-areas'
				? await dbClient.$executeRaw`DELETE TOP (${CLEAR_BATCH_SIZE}) FROM consultee_area`
				: await dbClient.$executeRaw`DELETE TOP (${CLEAR_BATCH_SIZE}) FROM case_boundary`;
		total += deleted;
		if (deleted < CLEAR_BATCH_SIZE) {
			return total;
		}
	}
}

export interface ImportOptions {
	batchSize?: number;
	onProgress?: (loaded: number, total: number) => void;
	/**
	 * Case boundaries: clear the table before loading (see clearExistingRows) - only once the file
	 * has parsed and holds at least one feature, so a bad or empty file can't leave the table empty.
	 * Consultee areas are always replaced.
	 */
	replace?: boolean;
	/** How much source GeoJSON, in characters, to load at a time (see CHUNK_CHARACTERS). */
	chunkCharacters?: number;
}

async function clearIfReplacing(
	dbClient: PrismaClient,
	type: ImportType,
	featureCount: number,
	replace: boolean
): Promise<void> {
	if (!replace) {
		return;
	}
	if (featureCount === 0) {
		throw new Error(`Refusing to replace ${type} with a file holding no features`);
	}
	const deleted = await clearExistingRows(dbClient, type);
	console.log(`Cleared ${deleted} existing ${type} rows`);
}

// how much source GeoJSON (in characters) is loaded at a time: enough for hundreds of ordinary
// areas per chunk, while a national-scale shape of tens of megabytes goes on its own - so the
// import's memory stays near this, whatever the file's size
const CHUNK_CHARACTERS = 32 * 1024 * 1024;

/**
 * Import a GeoJSON file into `type`'s table, a chunk at a time: read it once to check every
 * feature maps (a feature that doesn't throws before anything is deleted) and count them, run
 * `beforeLoad` with the count - clearing the table if replacing, say - then read it again and load
 * each chunk.
 */
export async function importFile<F extends ConsulteeAreaFeature | CaseBoundaryFeature>(
	dbClient: PrismaClient,
	filePath: string,
	type: ImportType,
	toRow: (feature: RawFeature) => F,
	load: (
		dbClient: PrismaClient,
		featureCollection: { type: 'FeatureCollection'; features: F[] },
		options: LoadOptions
	) => Promise<number>,
	options: Omit<ImportOptions, 'replace'> & { beforeLoad: (featureCount: number) => Promise<void> }
): Promise<number> {
	let total = 0;
	for await (const { feature } of streamFeatures<RawFeature>(filePath)) {
		toRow(feature);
		total++;
	}
	await options.beforeLoad(total);

	let loaded = 0;
	let chunk: F[] = [];
	let chunkCharacters = 0;
	const loadChunk = async () => {
		const offset = loaded;
		loaded += await load(
			dbClient,
			{ type: 'FeatureCollection', features: chunk },
			{ batchSize: options.batchSize, onProgress: (done) => options.onProgress?.(offset + done, total) }
		);
		chunk = [];
		chunkCharacters = 0;
	};
	for await (const { feature, length } of streamFeatures<RawFeature>(filePath)) {
		if (chunk.length > 0 && chunkCharacters + length > (options.chunkCharacters ?? CHUNK_CHARACTERS)) {
			await loadChunk();
		}
		chunk.push(toRow(feature));
		chunkCharacters += length;
	}
	if (chunk.length > 0) {
		await loadChunk();
	}
	return loaded;
}

/**
 * Replace consultee_area with a reference-data GeoJSON file (the reference data export, or the
 * small sample in apps/function-python/setup_database/sample_data/reference_data.geojson). Always
 * a replace: the table holds exactly the file, never an older export's rows alongside it. Every
 * group's rows are replaced at once, so the log of group loads (seed/consultee-area-groups.ts)
 * starts again: the quarter of what's loaded isn't known until a group is next loaded.
 */
export async function importConsulteeAreas(
	dbClient: PrismaClient,
	filePath: string,
	options: Omit<ImportOptions, 'replace'> = {}
): Promise<number> {
	return importFile(dbClient, filePath, 'consultee-areas', (feature) => toConsulteeArea(feature), loadConsulteeAreas, {
		...options,
		beforeLoad: async (featureCount) => {
			await clearIfReplacing(dbClient, 'consultee-areas', featureCount, true);
			await dbClient.$executeRaw`DELETE FROM reference_data_load`;
		}
	});
}

/**
 * Read a project/case-boundary GeoJSON file (same shape as
 * apps/function-python/setup_database/sample_data/sample_application_boundaries.geojson) and load
 * it into case_boundary - replacing the table with `replace`, else merging into it by id.
 */
export async function importCaseBoundaries(
	dbClient: PrismaClient,
	filePath: string,
	options: ImportOptions = {}
): Promise<number> {
	return importFile(dbClient, filePath, 'case-boundaries', toCaseBoundary, loadCaseBoundaries, {
		...options,
		beforeLoad: (featureCount) => clearIfReplacing(dbClient, 'case-boundaries', featureCount, Boolean(options.replace))
	});
}
