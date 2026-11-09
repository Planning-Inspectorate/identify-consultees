/**
 * Load the reference data in an environment's blob storage into its database: each group's newest
 * file, by the date its data is from, as the admin page's Load button does. A group already loaded
 * from that file - its rows still what that load put in, and the file not changed since - is left
 * alone, so running it again only loads what's new. Run by .azure/pipelines/load-reference-data.yml,
 * and by promote-reference-data.yml once it has copied the files on:
 *
 *   npm run load-reference-data                   (load what's new)
 *   npm run load-reference-data -- --clear=2026Q4 (empty a quarter's dataset first, then load)
 *   npm run load-reference-data -- --clear=2026Q4 --no-load
 *
 * A group that can't be loaded - its file refused (see importConsulteeAreaGroup) - doesn't stop the
 * others; the run fails at the end, naming each. Needs SQL_CONNECTION_STRING, BLOB_STORE_HOST and
 * BLOB_STORE_CONTAINER, and an Azure identity with Storage Blob Data Reader on that container.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '../client/client.ts';
import { loadConfig } from '../configuration/config.ts';
import { datasetInUse, listDatasets } from '../geospatial/consultee-areas.ts';
import { newDatabaseClient, withExtendedTimeout } from '../index.ts';
import type { GroupLoad, LatestGroupLoad } from './consultee-area-groups.ts';
import {
	clearConsulteeAreas,
	groupRowCounts,
	importConsulteeAreaGroup,
	latestGroupFiles,
	latestGroupLoads,
	quarterOf
} from './consultee-area-groups.ts';
import type { StoredBlob } from './import-from-blob.ts';
import { downloadBlobToTempFile, listBlobs } from './import-from-blob.ts';
import type { ReferenceDataConfig } from './reference-data.ts';
import { REFERENCE_DATA_CONFIG } from './reference-data.ts';

// see withExtendedTimeout in import-cli.ts
const IMPORT_REQUEST_TIMEOUT_MS = 120_000;

const QUARTER = /^\d{4}Q[1-4]$/;

/** A load refused, or groups that failed - its message says why. */
export class LoadError extends Error {}

/** The environment's database, as loading needs it. Stands in for it in tests. */
export interface Database {
	quarters(): Promise<string[]>;
	inUse(): Promise<string>;
	latestLoads(quarter: string): Promise<Map<string, LatestGroupLoad>>;
	rowCounts(quarter: string): Promise<Map<string, number>>;
	importGroup(filePath: string, blobName: string): Promise<GroupLoad>;
	clear(quarter: string): Promise<number>;
}

/** The environment's blob container. Stands in for it in tests. */
export interface Files {
	list(): Promise<StoredBlob[]>;
	download: typeof downloadBlobToTempFile;
}

export function sqlDatabase(dbClient: PrismaClient, config: ReferenceDataConfig = REFERENCE_DATA_CONFIG): Database {
	return {
		quarters: async () => (await listDatasets(dbClient)).map((dataset) => dataset.quarter),
		inUse: () => datasetInUse(dbClient),
		latestLoads: (quarter) => latestGroupLoads(dbClient, quarter),
		rowCounts: (quarter) => groupRowCounts(dbClient, config, quarter),
		importGroup: (filePath, blobName) => importConsulteeAreaGroup(dbClient, filePath, blobName, { config }),
		clear: (quarter) => clearConsulteeAreas(dbClient, quarter)
	};
}

export interface LoadArgs {
	/** The quarter whose dataset is emptied first. */
	clear?: string;
	load: boolean;
}

export function parseLoadArgs(argv: string[]): LoadArgs {
	let clear: string | undefined;
	let load = true;
	for (const arg of argv) {
		const match = /^--clear=(.*)$/.exec(arg);
		if (match) {
			// a blank --clear= (the pipeline's default) clears nothing
			clear = match[1].trim() || undefined;
		} else if (arg === '--no-load') {
			load = false;
		} else {
			throw new LoadError(`"${arg}" isn't an option - use --clear=<quarter> and --no-load`);
		}
	}
	if (clear !== undefined && !QUARTER.test(clear)) {
		throw new LoadError(`"${clear}" isn't a quarter - write it as in 2026Q4`);
	}
	if (!clear && !load) {
		throw new LoadError('--no-load with nothing to clear does nothing');
	}
	return { clear, load };
}

/** Whether `file` is what the group's last load into its quarter loaded, with its rows still there. */
function alreadyLoaded(file: StoredBlob, load: LatestGroupLoad, rows: number | undefined): boolean {
	return load.blobName === file.name && load.rowsLoaded === rows && file.lastModified <= load.loadedAt;
}

/**
 * Clear, then load, as `args` asks - logging each group - and say which dataset is in use after.
 * Throws a LoadError naming the groups that failed, once the rest are loaded.
 */
export async function loadReferenceData(
	db: Database,
	files: Files,
	args: LoadArgs,
	log: (line: string) => void = console.log,
	config: ReferenceDataConfig = REFERENCE_DATA_CONFIG
): Promise<void> {
	if (args.clear) {
		if (!(await db.quarters()).includes(args.clear)) {
			throw new LoadError(`There's no ${args.clear} dataset to clear`);
		}
		log(`Cleared ${args.clear}: ${await db.clear(args.clear)} consultee areas`);
	}
	if (args.load) {
		const latest = latestGroupFiles(await files.list(), config);
		const failed: string[] = [];
		for (const group of config.groups) {
			const file = latest.get(group.slug);
			if (!file) {
				log(`${group.name}: no file in blob storage - skipped`);
				continue;
			}
			const quarter = quarterOf(file.dataDate);
			const load = (await db.latestLoads(quarter)).get(group.slug);
			if (load && alreadyLoaded(file, load, (await db.rowCounts(quarter)).get(group.slug))) {
				log(`${group.name}: ${file.name} is already loaded into ${quarter} - skipped`);
				continue;
			}
			const { filePath, cleanup } = await files.download(file.name);
			try {
				const loaded = await db.importGroup(filePath, file.name);
				log(`${group.name}: loaded ${file.name} into ${loaded.quarter} - ${loaded.rowsLoaded} consultee areas`);
			} catch (error) {
				failed.push(group.name);
				log(`${group.name}: couldn't load ${file.name} - ${error instanceof Error ? error.message : error}`);
			} finally {
				await cleanup();
			}
		}
		if (failed.length > 0) {
			throw new LoadError(`Couldn't load ${failed.join(', ')} - see above. The other groups were loaded`);
		}
	}
	log(`The dataset in use is ${await db.inUse()}`);
}

const BLOB_FILES: Files = { list: listBlobs, download: downloadBlobToTempFile };

/** The script: `argv`'s options, against the database `connect` opens and the blob container. */
export async function main(
	argv: string[],
	connect: () => PrismaClient = () =>
		newDatabaseClient(withExtendedTimeout(loadConfig().db, IMPORT_REQUEST_TIMEOUT_MS)),
	files: Files = BLOB_FILES,
	log: (line: string) => void = console.log
): Promise<void> {
	const args = parseLoadArgs(argv);
	const dbClient = connect();
	try {
		await loadReferenceData(sqlDatabase(dbClient), files, args, log);
	} finally {
		await dbClient.$disconnect();
	}
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
	await main(process.argv.slice(2)).catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
}
