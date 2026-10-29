/**
 * Promote a quarter's reference data from one environment to the next - Test to Training,
 * Training to Prod - as the files that were loaded, not as a copy of the database: the target loads
 * them exactly as its own admin page would (importConsulteeAreaGroup), so its case boundaries and
 * everything else stay its own. Run by .azure/pipelines/promote-reference-data.yml, a job per
 * environment, each signed in to its own environment only:
 *
 *   npm run promote-reference-data -- export --quarter=2026Q4 --dir=<dir>   (on the source)
 *   npm run promote-reference-data -- import --dir=<dir>                     (on the target)
 *
 * `export` promotes only what the source is using: the quarter must be its dataset in use, and
 * each group's rows there must be what its last load put in. It downloads each group's file into
 * <dir> with a manifest of what each loaded. `import` uploads the files to the target's blob
 * storage, loads each group, and fails unless each loads as many rows as it did on the source and
 * the quarter becomes the target's dataset in use. Until every group is in, the target keeps
 * using its previous quarter, so a failed promotion changes nothing anyone sees.
 *
 * Needs SQL_CONNECTION_STRING, BLOB_STORE_HOST and BLOB_STORE_CONTAINER for the environment it
 * runs against, and an Azure identity with Storage Blob Data Contributor on that container (see
 * import-from-blob.ts).
 */
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '../client/client.ts';
import { loadConfig } from '../configuration/config.ts';
import { datasetInUse } from '../geospatial/consultee-areas.ts';
import { newDatabaseClient, withExtendedTimeout } from '../index.ts';
import type { GroupLoad, LatestGroupLoad } from './consultee-area-groups.ts';
import {
	groupRowCounts,
	groupsStillToLoad,
	importConsulteeAreaGroup,
	latestGroupLoads,
	parseGroupBlobName,
	quarterOf
} from './consultee-area-groups.ts';
import { referenceDataContainer } from './import-from-blob.ts';
import type { ReferenceDataConfig, ReferenceDataGroup } from './reference-data.ts';
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

/** The reference data in one environment's database. Stands in for it in tests. */
export interface Dataset {
	inUse(): Promise<string>;
	latestLoads(quarter: string): Promise<Map<string, LatestGroupLoad>>;
	rowCounts(quarter: string): Promise<Map<string, number>>;
	stillToLoad(quarter: string): Promise<ReferenceDataGroup[]>;
	loadGroup(filePath: string, blobName: string): Promise<GroupLoad>;
	/** Make `quarter` the dataset in use again. */
	use(quarter: string): Promise<void>;
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
		rowCounts: (quarter) => groupRowCounts(dbClient, config, quarter),
		stillToLoad: (quarter) => groupsStillToLoad(dbClient, quarter, config),
		loadGroup: (filePath, blobName) => importConsulteeAreaGroup(dbClient, filePath, blobName, { config }),
		use: async (quarter) => {
			await dbClient.$executeRaw`EXEC dbo.use_consultee_area_dataset ${quarter}`;
		}
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
					`${blobName} is already in ${container.containerName} but isn't the same file (${contentLength} bytes, not ${size}). Nothing was loaded`
				);
			}
			await blob.uploadFile(filePath);
			return 'uploaded';
		}
	};
}

/**
 * Write `quarter`'s group files and their manifest to `dir`, from the source environment - only
 * if it's the dataset in use there, and each group's rows are what its last load put in.
 */
export async function exportQuarter(
	dataset: Dataset,
	store: FileStore,
	quarter: string,
	dir: string,
	config: ReferenceDataConfig = REFERENCE_DATA_CONFIG
): Promise<Manifest> {
	if (!QUARTER.test(quarter)) {
		throw new PromotionError(`"${quarter}" isn't a quarter - write it as in 2026Q4`);
	}
	const inUse = await dataset.inUse();
	if (inUse !== quarter) {
		throw new PromotionError(
			`Only the dataset in use can be promoted, so it's what was checked: this environment uses ${inUse}, not ${quarter}`
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
					`${group.name} has ${rows} rows in ${quarter} but no load on record, so there's no file to promote - load it again here first`
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
		throw new PromotionError(`${quarter} has no groups loaded, so there's nothing to promote`);
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
 * Upload and load the files `export` wrote to `dir` into the target environment, and check it now
 * uses the quarter with every group loading as many rows as on the source. If one loads a
 * different number, the target goes back to the dataset it was using, so nobody screens against
 * data that differs from what was checked.
 */
export async function importQuarter(
	dataset: Dataset,
	store: FileStore,
	dir: string,
	log: (line: string) => void = console.log,
	config: ReferenceDataConfig = REFERENCE_DATA_CONFIG
): Promise<Manifest> {
	const manifest = parseManifest(await readFile(path.join(dir, MANIFEST_FILE), 'utf8'), config);
	const usedBefore = await dataset.inUse();
	for (const file of manifest.files) {
		const uploaded = await store.upload(path.join(dir, file.blobName), file.blobName);
		log(`${file.blobName}: ${uploaded === 'uploaded' ? 'uploaded' : 'already in blob storage'}`);
	}
	const mismatched: string[] = [];
	for (const file of manifest.files) {
		const load = await dataset.loadGroup(path.join(dir, file.blobName), file.blobName);
		log(`${load.group.name}: ${load.rowsLoaded} rows (${file.rowsLoaded} on the source)`);
		if (load.rowsLoaded !== file.rowsLoaded) {
			mismatched.push(`${load.group.name} loaded ${load.rowsLoaded} rows, not ${file.rowsLoaded}`);
		}
	}
	if (mismatched.length > 0) {
		const switchedBack = usedBefore !== manifest.quarter && (await dataset.inUse()) === manifest.quarter;
		if (switchedBack) {
			await dataset.use(usedBefore);
		}
		throw new PromotionError(
			`${mismatched.join('; ')} - is the same release deployed to both environments? config/reference-data.yaml decides which rows load.${
				switchedBack ? ` This environment is back on ${usedBefore}` : ''
			}`
		);
	}
	const inUse = await dataset.inUse();
	if (inUse !== manifest.quarter) {
		const waiting = (await dataset.stillToLoad(manifest.quarter)).map((group) => group.name);
		throw new PromotionError(
			`${manifest.quarter} isn't in use yet - still waiting for ${waiting.join(', ') || 'nothing (it may be older than the dataset in use)'}; this environment still uses ${inUse}`
		);
	}
	log(`${manifest.quarter} is the dataset in use`);
	return manifest;
}

export interface PromotionArgs {
	command: 'export' | 'import';
	dir: string;
	quarter?: string;
}

export function parsePromotionArgs(argv: string[]): PromotionArgs {
	const [command, ...rest] = argv;
	if (command !== 'export' && command !== 'import') {
		throw new Error('the first argument must be "export" or "import"');
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
	if (command === 'export' && !values.quarter) {
		throw new Error('export needs --quarter, as in --quarter=2026Q4');
	}
	return { command, dir: values.dir, quarter: values.quarter };
}

async function run() {
	const args = parsePromotionArgs(process.argv.slice(2));
	const dbClient = newDatabaseClient(withExtendedTimeout(loadConfig().db, IMPORT_REQUEST_TIMEOUT_MS));
	try {
		const dataset = databaseDataset(dbClient);
		const store = blobFileStore();
		const manifest =
			args.command === 'export'
				? await exportQuarter(dataset, store, args.quarter ?? '', args.dir)
				: await importQuarter(dataset, store, args.dir);
		console.log(`${args.command === 'export' ? 'Exported' : 'Imported'} ${manifest.quarter}:`);
		for (const file of manifest.files) {
			console.log(`  ${file.blobName}: ${file.rowsLoaded} rows`);
		}
	} finally {
		await dbClient.$disconnect();
	}
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
	await run();
}
