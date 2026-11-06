/**
 * Copy a quarter's reference data files from one environment's blob storage to the next's - Test
 * to Training, Training to Prod - ready for its admin page to load (/admin/import-reference-data).
 * Only the files the source loaded are copied, not its database, so the target's case boundaries
 * and everything else stay its own. Run by .azure/pipelines/promote-reference-data.yml, a job per
 * environment, each signed in to its own environment only:
 *
 *   npm run promote-reference-data -- export [--quarter=2026Q4] --dir=<dir>   (on the source)
 *   npm run promote-reference-data -- copy --dir=<dir>                        (on the target)
 *
 * `export` copies only what the source is using - its dataset in use, or `--quarter` if that's
 * it - and only if each group's rows there are what its last load put in. It downloads each
 * group's file into <dir> with a manifest of what each loaded. `copy` uploads the files to the
 * target's blob storage, refusing one already there under the same name but different; nothing is
 * loaded until someone loads it on the target's admin page.
 *
 * `export` needs SQL_CONNECTION_STRING; both need BLOB_STORE_HOST and BLOB_STORE_CONTAINER for the
 * environment they run against, and an Azure identity with Storage Blob Data Contributor on that
 * container (see import-from-blob.ts).
 */
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '../client/client.ts';
import { loadConfig } from '../configuration/config.ts';
import { datasetInUse } from '../geospatial/consultee-areas.ts';
import { newDatabaseClient, withExtendedTimeout } from '../index.ts';
import type { LatestGroupLoad } from './consultee-area-groups.ts';
import { groupRowCounts, latestGroupLoads, parseGroupBlobName, quarterOf } from './consultee-area-groups.ts';
import { referenceDataContainer } from './import-from-blob.ts';
import type { ReferenceDataConfig } from './reference-data.ts';
import { REFERENCE_DATA_CONFIG } from './reference-data.ts';

// see withExtendedTimeout in import-cli.ts
const IMPORT_REQUEST_TIMEOUT_MS = 120_000;

export const MANIFEST_FILE = 'manifest.json';

const QUARTER = /^\d{4}Q[1-4]$/;

/** One group's file, as the source loaded it. */
export interface ManifestFile {
	group: string;
	blobName: string;
	rowsLoaded: number;
}

/** What `export` wrote: the quarter, and each group's file with the rows it loaded on the source. */
export interface Manifest {
	version: 1;
	quarter: string;
	files: ManifestFile[];
}

/** A promotion refused or failed - its message says why, and what to do. */
export class PromotionError extends Error {}

/** The reference data in the source environment's database. Stands in for it in tests. */
export interface Dataset {
	inUse(): Promise<string>;
	latestLoads(quarter: string): Promise<Map<string, LatestGroupLoad>>;
	rowCounts(quarter: string): Promise<Map<string, number>>;
}

/** One environment's blob container. Stands in for it in tests. */
export interface FileStore {
	download(blobName: string, filePath: string): Promise<void>;
	/** Upload `filePath` as `blobName`: 'unchanged' if the same file is already there. */
	upload(filePath: string, blobName: string): Promise<'uploaded' | 'unchanged'>;
}

export function databaseDataset(dbClient: PrismaClient, config: ReferenceDataConfig = REFERENCE_DATA_CONFIG): Dataset {
	return {
		inUse: () => datasetInUse(dbClient),
		latestLoads: (quarter) => latestGroupLoads(dbClient, quarter),
		rowCounts: (quarter) => groupRowCounts(dbClient, config, quarter)
	};
}

/** BLOB_STORE_HOST's BLOB_STORE_CONTAINER. A file of the same name but a different size is refused. */
export function blobFileStore(): FileStore {
	const container = referenceDataContainer();
	return {
		download: async (blobName, filePath) => {
			await container.getBlobClient(blobName).downloadToFile(filePath);
		},
		upload: async (filePath, blobName) => {
			const blob = container.getBlockBlobClient(blobName);
			const { size } = await stat(filePath);
			if (await blob.exists()) {
				const { contentLength } = await blob.getProperties();
				if (contentLength === size) {
					return 'unchanged';
				}
				throw new PromotionError(
					`${blobName} is already in ${container.containerName} but isn't the same file (${contentLength} bytes, not ${size}) - nothing more was copied`
				);
			}
			await blob.uploadFile(filePath);
			return 'uploaded';
		}
	};
}

/**
 * Write the dataset in use's group files and their manifest to `dir`, from the source environment -
 * only if each group's rows are what its last load put in. A `quarter` given must be the one in
 * use: a check that it's the one that was meant.
 */
export async function exportQuarter(
	dataset: Dataset,
	store: FileStore,
	requested: string | undefined,
	dir: string,
	config: ReferenceDataConfig = REFERENCE_DATA_CONFIG
): Promise<Manifest> {
	if (requested !== undefined && !QUARTER.test(requested)) {
		throw new PromotionError(`"${requested}" isn't a quarter - write it as in 2026Q4`);
	}
	const quarter = await dataset.inUse();
	if (requested !== undefined && requested !== quarter) {
		throw new PromotionError(
			`Only the dataset in use can be copied, so it's what was checked: this environment uses ${quarter}, not ${requested}`
		);
	}
	const loads = await dataset.latestLoads(quarter);
	const counts = await dataset.rowCounts(quarter);
	const files: ManifestFile[] = [];
	for (const group of config.groups) {
		const load = loads.get(group.slug);
		const rows = counts.get(group.slug) ?? 0;
		if (!load) {
			if (rows > 0) {
				throw new PromotionError(
					`${group.name} has ${rows} rows in ${quarter} but no load on record, so there's no file to copy - load it again here first`
				);
			}
			continue;
		}
		if (load.rowsLoaded !== rows) {
			throw new PromotionError(
				`${group.name} has ${rows} rows in ${quarter}, but its last load (${load.blobName}) put in ${load.rowsLoaded} - load it again here first`
			);
		}
		files.push({ group: group.slug, blobName: load.blobName, rowsLoaded: load.rowsLoaded });
	}
	if (files.length === 0) {
		throw new PromotionError(`${quarter} has no groups loaded, so there's nothing to copy`);
	}
	for (const file of files) {
		await store.download(file.blobName, path.join(dir, file.blobName));
	}
	const manifest: Manifest = { version: 1, quarter, files };
	await writeFile(path.join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, '\t')}\n`);
	return manifest;
}

/** The manifest `export` wrote, checked: every file a group's, from the manifest's quarter. */
export function parseManifest(text: string, config: ReferenceDataConfig = REFERENCE_DATA_CONFIG): Manifest {
	const manifest = JSON.parse(text) as Partial<Manifest>;
	if (manifest?.version !== 1 || !QUARTER.test(manifest.quarter ?? '') || !Array.isArray(manifest.files)) {
		throw new PromotionError(`${MANIFEST_FILE} isn't one export wrote`);
	}
	for (const file of manifest.files) {
		const parsed = parseGroupBlobName(file?.blobName ?? '', config);
		if (!parsed || parsed.group.slug !== file.group || quarterOf(parsed.dataDate) !== manifest.quarter) {
			throw new PromotionError(
				`${MANIFEST_FILE} lists ${file?.blobName}, which isn't a ${manifest.quarter} group file`
			);
		}
		if (!Number.isInteger(file.rowsLoaded) || file.rowsLoaded < 1) {
			throw new PromotionError(`${MANIFEST_FILE} gives ${file.blobName} no rows`);
		}
	}
	return manifest as Manifest;
}

/**
 * Upload the files `export` wrote to `dir` to the target environment's blob storage, ready to load
 * on its admin page. A file already there under the same name must be the same file.
 */
export async function copyQuarter(
	store: FileStore,
	dir: string,
	log: (line: string) => void = console.log,
	config: ReferenceDataConfig = REFERENCE_DATA_CONFIG
): Promise<Manifest> {
	const manifest = parseManifest(await readFile(path.join(dir, MANIFEST_FILE), 'utf8'), config);
	for (const file of manifest.files) {
		const uploaded = await store.upload(path.join(dir, file.blobName), file.blobName);
		log(`${file.blobName}: ${uploaded === 'uploaded' ? 'copied' : 'already in blob storage'}`);
	}
	return manifest;
}

export interface PromotionArgs {
	command: 'export' | 'copy';
	dir: string;
	quarter: string | undefined;
}

export function parsePromotionArgs(argv: string[]): PromotionArgs {
	const [command, ...rest] = argv;
	if (command !== 'export' && command !== 'copy') {
		throw new Error('the first argument must be "export" or "copy"');
	}
	const values = Object.fromEntries(
		rest.flatMap((arg) => {
			const match = /^--([^=]+)=(.*)$/.exec(arg);
			return match ? [[match[1], match[2]]] : [];
		})
	);
	if (!values.dir) {
		throw new Error('--dir is required');
	}
	// an empty --quarter= (the pipeline's default) means the one in use
	return { command, dir: values.dir, quarter: values.quarter || undefined };
}

/**
 * Run the export or copy `argv` asks for against `store` - and, for an export, the database
 * `openDataset` opens - logging what it did.
 */
export async function run(
	argv: string[],
	openDataset: () => Dataset,
	store: FileStore,
	log: (line: string) => void = console.log
): Promise<void> {
	const args = parsePromotionArgs(argv);
	const manifest =
		args.command === 'export'
			? await exportQuarter(openDataset(), store, args.quarter, args.dir)
			: await copyQuarter(store, args.dir, log);
	log(`${args.command === 'export' ? 'Exported' : 'Copied'} ${manifest.quarter}:`);
	for (const file of manifest.files) {
		log(`  ${file.blobName}: ${file.rowsLoaded} rows`);
	}
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
	// only an export reads the database - the copy job has no connection string
	let dbClient: PrismaClient | undefined;
	const openDataset = () => {
		dbClient = newDatabaseClient(withExtendedTimeout(loadConfig().db, IMPORT_REQUEST_TIMEOUT_MS));
		return databaseDataset(dbClient);
	};
	try {
		await run(process.argv.slice(2), openDataset, blobFileStore());
	} finally {
		await dbClient?.$disconnect();
	}
}
