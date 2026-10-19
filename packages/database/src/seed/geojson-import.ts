import { Prisma, type PrismaClient } from '@pins/identify-consultees-database/src/client/client.ts';
import { createHash } from 'node:crypto';
import type { CaseBoundaryFeature } from '../geospatial/case-boundaries.ts';
import { loadCaseBoundaries } from '../geospatial/case-boundaries.ts';
import type { ConsulteeAreaFeature, LoadOptions } from '../geospatial/consultee-areas.ts';
import { loadConsulteeAreas } from '../geospatial/consultee-areas.ts';
import type { Geometry } from '../geospatial/wkt.ts';
import { streamFeatures } from './feature-stream.ts';
import { consulteeCategoryFor, REFERENCE_DATA_CONFIG, type ReferenceDataConfig } from './reference-data.ts';

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

export function toConsulteeArea(
	feature: RawFeature,
	config: ReferenceDataConfig = REFERENCE_DATA_CONFIG
): ConsulteeAreaFeature {
	const props = feature.properties;

	// two source shapes seen so far: the original small ArcGIS-style sample (consulteeCategory,
	// camelCase, metadata as a real JSON object) and the real "combined reference data" export
	// (consultee_category, snake_case, metadata as a Python dict repr string in earlier exports -
	// not valid JSON, so it's kept as-is under rawMetadata rather than risking corruption from a
	// fragile parser). The export's category is a broad group (Health, Transport...) since October
	// 2026, so a feature whose id names its dataset takes that dataset's category instead - see
	// config/reference-data.yaml - and keeps the group as sourceCategory
	const fileCategory = (props.consulteeCategory ?? props.consultee_category) as string | undefined;
	const consulteeCategory = consulteeCategoryFor(String(props.id ?? ''), fileCategory, config);
	const rawMetadata = props.metadata;
	let metadata: Record<string, unknown> = {};
	if (rawMetadata && typeof rawMetadata === 'object') {
		metadata = rawMetadata as Record<string, unknown>;
	} else if (typeof rawMetadata === 'string') {
		metadata = { rawMetadata };
	}

	return {
		id: deterministicId(`consultee-area:${props.id}`),
		type: 'Feature',
		geometry: feature.geometry,
		properties: {
			consultee: (props.consultee as string) ?? null,
			region: (props.region as string) ?? null,
			consulteeCategory: consulteeCategory ?? null,
			caseReference: (props.caseId as string) ?? null,
			documentId: (props.documentId as string) ?? null,
			consulteeId: (props.consulteeId as string) ?? null,
			organisationId: (props.organisationId as string) ?? null,
			currentVersion: (props.currentVersion as number) ?? 1,
			// keep the source data's own id/lastUpdated alongside its metadata, rather than dropping
			// them - our schema only has a dedicated column for currentVersion
			metadata: {
				...metadata,
				sourceId: props.id,
				sourceLastUpdated: props.last_updated,
				...(fileCategory && fileCategory !== consulteeCategory ? { sourceCategory: fileCategory } : {})
			}
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
const CLEAR_BATCH_SIZE = 500;

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

/**
 * Delete the consultee areas of `categories`, a batch at a time - so an import of some datasets
 * replaces those and leaves the rest. A category the file doesn't hold keeps its rows.
 */
export async function clearCategories(dbClient: PrismaClient, categories: string[]): Promise<number> {
	let total = 0;
	for (;;) {
		const deleted = await dbClient.$executeRaw`
			DELETE TOP (${CLEAR_BATCH_SIZE}) FROM consultee_area WHERE consulteeCategory IN (${Prisma.join(categories)})
		`;
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
	 * Clear the table before loading (see clearExistingRows) - only once the file has parsed and
	 * holds at least one feature, so a bad or empty file can't leave the table empty. For consultee
	 * areas, `'categories'` clears only the categories the file holds (see clearCategories).
	 */
	replace?: boolean | 'categories';
	/** How much source GeoJSON, in characters, to load at a time (see CHUNK_CHARACTERS). */
	chunkCharacters?: number;
}

async function clearIfReplacing(
	dbClient: PrismaClient,
	type: ImportType,
	featureCount: number,
	categories: Set<string>,
	options: ImportOptions
): Promise<void> {
	if (!options.replace) {
		return;
	}
	if (featureCount === 0) {
		throw new Error(`Refusing to replace ${type} with a file holding no features`);
	}
	if (options.replace === 'categories' && type === 'consultee-areas') {
		const named = [...categories].sort();
		const deleted = named.length > 0 ? await clearCategories(dbClient, named) : 0;
		console.log(`Cleared ${deleted} existing ${type} rows of ${named.join(', ')}`);
		return;
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
 * feature maps (a feature that doesn't throws before anything is deleted), count them and gather
 * their categories, clear what `replace` asks for, then read it again and load each chunk.
 */
async function importFile<F extends ConsulteeAreaFeature | CaseBoundaryFeature>(
	dbClient: PrismaClient,
	filePath: string,
	type: ImportType,
	toRow: (feature: RawFeature) => F,
	load: (
		dbClient: PrismaClient,
		featureCollection: { type: 'FeatureCollection'; features: F[] },
		options: LoadOptions
	) => Promise<number>,
	options: ImportOptions
): Promise<number> {
	let total = 0;
	const categories = new Set<string>();
	for await (const { feature } of streamFeatures<RawFeature>(filePath)) {
		const row = toRow(feature);
		total++;
		if ('consulteeCategory' in row.properties && row.properties.consulteeCategory) {
			categories.add(row.properties.consulteeCategory);
		}
	}
	await clearIfReplacing(dbClient, type, total, categories, options);

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
 * Read a reference-data GeoJSON file (same shape as
 * apps/function-python/setup_database/sample_data/reference_data.geojson, just potentially many
 * more/larger features) and load it into consultee_area.
 */
export async function importConsulteeAreas(
	dbClient: PrismaClient,
	filePath: string,
	options: ImportOptions = {}
): Promise<number> {
	return importFile(
		dbClient,
		filePath,
		'consultee-areas',
		(feature) => toConsulteeArea(feature),
		loadConsulteeAreas,
		options
	);
}

/**
 * Read a project/case-boundary GeoJSON file (same shape as
 * apps/function-python/setup_database/sample_data/sample_application_boundaries.geojson) and load
 * it into case_boundary. Case boundaries have no category, so `'categories'` replaces them all.
 */
export async function importCaseBoundaries(
	dbClient: PrismaClient,
	filePath: string,
	options: ImportOptions = {}
): Promise<number> {
	return importFile(dbClient, filePath, 'case-boundaries', toCaseBoundary, loadCaseBoundaries, options);
}
