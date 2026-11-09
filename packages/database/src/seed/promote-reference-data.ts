/**
 * Copy the reference data files from one environment's blob storage to the next's - Test to
 * Training, Training to Prod: each group's newest file, by the date its data is from. Only files
 * move, never a database, so the target's case boundaries and everything else stay its own. Run by
 * .azure/pipelines/promote-reference-data.yml, a job per environment, each signed in to its own
 * environment only - which then loads the files there (load-reference-data.ts), unless told not to:
 *
 *   npm run promote-reference-data -- export --dir=<dir>   (on the source)
 *   npm run promote-reference-data -- copy --dir=<dir>     (on the target)
 *
 * `export` downloads each group's newest file into <dir> with a manifest of them. `copy` uploads
 * them to the target's blob storage, replacing one already there under the same name but different
 * - a file corrected on the source and copied on again.
 *
 * Both need BLOB_STORE_HOST and BLOB_STORE_CONTAINER for the environment they run against, and an
 * Azure identity with Storage Blob Data Contributor on that container (see import-from-blob.ts).
 */
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { latestGroupFiles, parseGroupBlobName } from './consultee-area-groups.ts';
import type { StoredBlob } from './import-from-blob.ts';
import { listBlobs, referenceDataContainer } from './import-from-blob.ts';
import type { ReferenceDataConfig } from './reference-data.ts';
import { REFERENCE_DATA_CONFIG } from './reference-data.ts';

export const MANIFEST_FILE = 'manifest.json';

/** One group's newest file in the source. */
export interface ManifestFile {
	group: string;
	blobName: string;
	size: number;
}

/** What `export` wrote: each group's newest file. */
export interface Manifest {
	version: 2;
	files: ManifestFile[];
}

/** A promotion refused or failed - its message says why, and what to do. */
export class PromotionError extends Error {}

/** One environment's blob container. Stands in for it in tests. */
export interface FileStore {
	list(): Promise<StoredBlob[]>;
	download(blobName: string, filePath: string): Promise<void>;
	/** Upload `filePath` as `blobName`: 'unchanged' if the same file is already there. */
	upload(filePath: string, blobName: string): Promise<'uploaded' | 'replaced' | 'unchanged'>;
}

/** BLOB_STORE_HOST's BLOB_STORE_CONTAINER. A file of the same name and size counts as the same file. */
export function blobFileStore(): FileStore {
	const container = referenceDataContainer();
	return {
		list: listBlobs,
		download: async (blobName, filePath) => {
			await container.getBlobClient(blobName).downloadToFile(filePath);
		},
		upload: async (filePath, blobName) => {
			const blob = container.getBlockBlobClient(blobName);
			const { size } = await stat(filePath);
			const exists = await blob.exists();
			if (exists && (await blob.getProperties()).contentLength === size) {
				return 'unchanged';
			}
			await blob.uploadFile(filePath);
			return exists ? 'replaced' : 'uploaded';
		}
	};
}

/** Write each group's newest file in the source's blob storage, and their manifest, to `dir`. */
export async function exportFiles(
	store: FileStore,
	dir: string,
	config: ReferenceDataConfig = REFERENCE_DATA_CONFIG
): Promise<Manifest> {
	const latest = latestGroupFiles(await store.list(), config);
	const files: ManifestFile[] = config.groups.flatMap((group) => {
		const file = latest.get(group.slug);
		return file ? [{ group: group.slug, blobName: file.name, size: file.size }] : [];
	});
	if (files.length === 0) {
		throw new PromotionError("There are no group files in this environment's blob storage, so there's nothing to copy");
	}
	for (const file of files) {
		await store.download(file.blobName, path.join(dir, file.blobName));
	}
	const manifest: Manifest = { version: 2, files };
	await writeFile(path.join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, '\t')}\n`);
	return manifest;
}

/** The manifest `export` wrote, checked: every file a group's. */
export function parseManifest(text: string, config: ReferenceDataConfig = REFERENCE_DATA_CONFIG): Manifest {
	const manifest = JSON.parse(text) as Partial<Manifest>;
	if (manifest?.version !== 2 || !Array.isArray(manifest.files)) {
		throw new PromotionError(`${MANIFEST_FILE} isn't one export wrote`);
	}
	for (const file of manifest.files) {
		const parsed = parseGroupBlobName(file?.blobName ?? '', config);
		if (!parsed || parsed.group.slug !== file.group) {
			throw new PromotionError(`${MANIFEST_FILE} lists ${file?.blobName}, which isn't a group's file`);
		}
	}
	return manifest as Manifest;
}

/**
 * Upload the files `export` wrote to `dir` to the target environment's blob storage, ready to load
 * (load-reference-data.ts). A different file there under the same name is replaced.
 */
export async function copyFiles(
	store: FileStore,
	dir: string,
	log: (line: string) => void = console.log,
	config: ReferenceDataConfig = REFERENCE_DATA_CONFIG
): Promise<Manifest> {
	const manifest = parseManifest(await readFile(path.join(dir, MANIFEST_FILE), 'utf8'), config);
	for (const file of manifest.files) {
		const uploaded = await store.upload(path.join(dir, file.blobName), file.blobName);
		log(`${file.blobName}: ${COPY_OUTCOMES[uploaded]}`);
	}
	return manifest;
}

const COPY_OUTCOMES = {
	uploaded: 'copied',
	replaced: 'copied, replacing a different file of the same name',
	unchanged: 'already in blob storage'
} as const;

export interface PromotionArgs {
	command: 'export' | 'copy';
	dir: string;
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
	return { command, dir: values.dir };
}

/** Run the export or copy `argv` asks for against `store`, logging what it did. */
export async function run(argv: string[], store: FileStore, log: (line: string) => void = console.log): Promise<void> {
	const args = parsePromotionArgs(argv);
	const manifest =
		args.command === 'export' ? await exportFiles(store, args.dir) : await copyFiles(store, args.dir, log);
	log(`${args.command === 'export' ? 'Exported' : 'Copied'}:`);
	for (const file of manifest.files) {
		log(`  ${file.blobName}`);
	}
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
	await run(process.argv.slice(2), blobFileStore());
}
