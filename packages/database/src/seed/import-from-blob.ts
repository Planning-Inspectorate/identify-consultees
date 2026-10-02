/**
 * Load a real GeoJSON file (reference/consultee area data, or project/case boundary data) from
 * the app's own blob storage container into the database - same import logic as import-cli.ts,
 * just fetching the source file from blob storage first. The real, full-size datasets are too
 * large to check into git (tens of MB each), so they're uploaded to blob storage once and loaded
 * from there by this script via db-seed.yml, rather than from a path on the pipeline agent's disk.
 *
 * Usage:
 *   npm run db-import-from-blob -- --type=consultee-areas --blob=combined_reference_data_v1.geojson
 *   npm run db-import-from-blob -- --type=case-boundaries --blob=all-project-boundaries.geojson
 *
 * Requires BLOB_STORE_HOST and BLOB_STORE_CONTAINER (the same env var names the running app
 * already uses - see infrastructure/app-web.tf) and an ambient Azure identity DefaultAzureCredential
 * can use (the pipeline's own Azure auth step when run in CI; `az login`'s cached credential for a
 * human running this locally). The storage account has shared-key auth disabled (Entra/RBAC only -
 * see infrastructure/storage.tf), so there's no connection-string/key option here.
 */
import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../configuration/config.ts';
import { newDatabaseClient, withExtendedTimeout } from '../index.ts';
import { importCaseBoundaries, importConsulteeAreas } from './geojson-import.ts';

// see withExtendedTimeout in import-cli.ts - a large/complex real geometry can exceed the
// driver's default ~15s request timeout regardless of batch size
const IMPORT_REQUEST_TIMEOUT_MS = 120_000;

export interface ParsedArgs {
	type: 'consultee-areas' | 'case-boundaries';
	blob: string;
	batchSize?: number;
}

export function parseArgs(argv: string[]): ParsedArgs {
	const values: Record<string, string> = {};
	for (const arg of argv) {
		const match = /^--([^=]+)=(.*)$/.exec(arg);
		if (match) {
			values[match[1]] = match[2];
		}
	}

	const type = values.type;
	if (type !== 'consultee-areas' && type !== 'case-boundaries') {
		throw new Error(`--type must be "consultee-areas" or "case-boundaries" (got: ${type ?? '(missing)'})`);
	}
	if (!values.blob) {
		throw new Error('--blob is required (the blob name within BLOB_STORE_CONTAINER)');
	}

	const batchSize = values['batch-size'] ? Number.parseInt(values['batch-size'], 10) : undefined;
	if (batchSize !== undefined && (!Number.isInteger(batchSize) || batchSize < 1)) {
		throw new Error(`--batch-size must be a positive integer (got: ${values['batch-size']})`);
	}

	return { type, blob: values.blob, batchSize };
}

/**
 * Download `blobName` from BLOB_STORE_CONTAINER to a local temp file, returning its path - the
 * existing import functions read from a file path, not a stream, so this just gets the source
 * data somewhere importConsulteeAreas/importCaseBoundaries can read it from, unchanged.
 */
export async function downloadBlobToTempFile(
	blobName: string
): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
	const blobStoreHost = process.env.BLOB_STORE_HOST;
	const blobStoreContainer = process.env.BLOB_STORE_CONTAINER;
	if (!blobStoreHost || !blobStoreContainer) {
		throw new Error('BLOB_STORE_HOST and BLOB_STORE_CONTAINER are required to import from blob storage');
	}

	const blobServiceClient = new BlobServiceClient(blobStoreHost, new DefaultAzureCredential());
	const containerClient = blobServiceClient.getContainerClient(blobStoreContainer);
	const blobClient = containerClient.getBlobClient(blobName);

	const tempDir = await mkdtemp(path.join(tmpdir(), 'identify-consultees-import-'));
	const filePath = path.join(tempDir, path.basename(blobName));
	const cleanup = () => rm(tempDir, { recursive: true, force: true });

	const downloadResponse = await blobClient.download();
	if (!downloadResponse.readableStreamBody) {
		await cleanup();
		throw new Error(`Blob "${blobName}" in container "${blobStoreContainer}" has no readable content`);
	}
	await pipeline(downloadResponse.readableStreamBody, createWriteStream(filePath));

	return { filePath, cleanup };
}

function logProgress(startedAt: number) {
	return (loaded: number, total: number) => {
		const elapsedSeconds = (Date.now() - startedAt) / 1000;
		const rate = loaded / elapsedSeconds;
		const remaining = total - loaded;
		const etaSeconds = rate > 0 ? Math.round(remaining / rate) : 0;
		console.log(`  ${loaded}/${total} (${rate.toFixed(0)} rows/s, ~${etaSeconds}s remaining)`);
	};
}

async function run() {
	const args = parseArgs(process.argv.slice(2));
	const config = loadConfig();
	const dbClient = newDatabaseClient(withExtendedTimeout(config.db, IMPORT_REQUEST_TIMEOUT_MS));

	console.log(`Downloading ${args.blob} from blob storage...`);
	const { filePath, cleanup } = await downloadBlobToTempFile(args.blob);

	console.log(`Importing ${args.type} from ${args.blob}...`);
	const startedAt = Date.now();

	try {
		const options = { batchSize: args.batchSize, onProgress: logProgress(startedAt) };
		const count =
			args.type === 'consultee-areas'
				? await importConsulteeAreas(dbClient, filePath, options)
				: await importCaseBoundaries(dbClient, filePath, options);

		const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
		console.log(`Imported ${count} rows in ${elapsedSeconds}s`);
	} catch (error) {
		console.error(error);
		throw error;
	} finally {
		await cleanup();
		await dbClient.$disconnect();
	}
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
	await run();
}
