import { BlobServiceClient } from '@azure/storage-blob';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { after, before, describe, mock, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PrismaClient } from '../client/client.ts';
import { loadConfig } from '../configuration/config.ts';
import { acquireDbTestLock, releaseDbTestLock } from '../db-test-lock.ts';
import { newDatabaseClient } from '../index.ts';
import { deterministicId } from './geojson-import.ts';
import { downloadBlobToTempFile, parseArgs } from './import-from-blob.ts';

describe('parseArgs', () => {
	test('parses a valid consultee-areas import', () => {
		assert.deepEqual(parseArgs(['--type=consultee-areas', '--blob=combined_reference_data_v1.geojson']), {
			type: 'consultee-areas',
			blob: 'combined_reference_data_v1.geojson',
			batchSize: undefined,
			replace: false
		});
	});

	test('parses --replace as a bare flag', () => {
		assert.equal(parseArgs(['--type=consultee-areas', '--blob=a.geojson', '--replace']).replace, true);
	});

	test('parses an optional positive batch size', () => {
		assert.deepEqual(
			parseArgs(['--type=case-boundaries', '--blob=all-project-boundaries.geojson', '--batch-size=25']),
			{
				type: 'case-boundaries',
				blob: 'all-project-boundaries.geojson',
				batchSize: 25,
				replace: false
			}
		);
	});

	test('ignores arguments that are not --key=value or --replace', () => {
		assert.deepEqual(parseArgs(['stray', '--type=consultee-areas', '--blob=a.geojson']), {
			type: 'consultee-areas',
			blob: 'a.geojson',
			batchSize: undefined,
			replace: false
		});
	});

	test('rejects an unknown or missing type', () => {
		assert.throws(() => parseArgs(['--blob=a.geojson']), /--type must be/);
		assert.throws(() => parseArgs(['--type=widgets', '--blob=a.geojson']), /--type must be/);
	});

	test('rejects a missing blob name', () => {
		assert.throws(() => parseArgs(['--type=consultee-areas']), /--blob is required/);
	});

	test('rejects a non-positive batch size', () => {
		assert.throws(
			() => parseArgs(['--type=consultee-areas', '--blob=a.geojson', '--batch-size=0']),
			/--batch-size must be a positive integer/
		);
		assert.throws(
			() => parseArgs(['--type=consultee-areas', '--blob=a.geojson', '--batch-size=nope']),
			/--batch-size must be a positive integer/
		);
	});
});

function withBlobEnv(host: string | undefined, container: string | undefined, fn: () => Promise<void> | void) {
	const originalHost = process.env.BLOB_STORE_HOST;
	const originalContainer = process.env.BLOB_STORE_CONTAINER;
	if (host === undefined) delete process.env.BLOB_STORE_HOST;
	else process.env.BLOB_STORE_HOST = host;
	if (container === undefined) delete process.env.BLOB_STORE_CONTAINER;
	else process.env.BLOB_STORE_CONTAINER = container;
	const restore = () => {
		if (originalHost === undefined) delete process.env.BLOB_STORE_HOST;
		else process.env.BLOB_STORE_HOST = originalHost;
		if (originalContainer === undefined) delete process.env.BLOB_STORE_CONTAINER;
		else process.env.BLOB_STORE_CONTAINER = originalContainer;
	};
	return Promise.resolve().then(fn).finally(restore);
}

const BLOB_ENV = { BLOB_STORE_HOST: 'https://blob.example.test', BLOB_STORE_CONTAINER: 'test-container' };

describe('downloadBlobToTempFile', () => {
	test('requires BLOB_STORE_HOST and BLOB_STORE_CONTAINER to be set', async () => {
		await withBlobEnv(undefined, undefined, async () => {
			await assert.rejects(() => downloadBlobToTempFile('a.geojson'), /BLOB_STORE_HOST and BLOB_STORE_CONTAINER/);
		});
	});

	test('requires the container name even when the host is set', async () => {
		await withBlobEnv('https://blob.example.test', undefined, async () => {
			await assert.rejects(() => downloadBlobToTempFile('a.geojson'), /BLOB_STORE_HOST and BLOB_STORE_CONTAINER/);
		});
	});

	// a stand-in container client lets the whole download path run without real blob storage
	function stubContainer(payload: string | null) {
		return mock.method(BlobServiceClient.prototype, 'getContainerClient', () => ({
			getBlobClient: () => ({
				download: async () => ({
					readableStreamBody: payload === null ? undefined : Readable.from([payload])
				})
			})
		}));
	}

	test('downloads the blob to a temp file that cleans itself up', async () => {
		const getContainerClient = stubContainer('{"type":"FeatureCollection","features":[]}');
		try {
			await withBlobEnv(BLOB_ENV.BLOB_STORE_HOST, BLOB_ENV.BLOB_STORE_CONTAINER, async () => {
				const { filePath, cleanup } = await downloadBlobToTempFile('nested/data.geojson');
				assert.equal(filePath.endsWith('data.geojson'), true);
				assert.equal(await readFile(filePath, 'utf8'), '{"type":"FeatureCollection","features":[]}');
				assert.equal(getContainerClient.mock.calls[0].arguments[0], 'test-container');
				await cleanup();
				assert.equal(existsSync(filePath), false);
			});
		} finally {
			getContainerClient.mock.restore();
		}
	});

	test('cleans up and throws when the blob has no readable content', async () => {
		const getContainerClient = stubContainer(null);
		try {
			await withBlobEnv(BLOB_ENV.BLOB_STORE_HOST, BLOB_ENV.BLOB_STORE_CONTAINER, async () => {
				await assert.rejects(() => downloadBlobToTempFile('a.geojson'), /has no readable content/);
			});
		} finally {
			getContainerClient.mock.restore();
		}
	});
});

// the rest of the module only runs as a script (the isMain block), so these tests spawn the real
// CLI in a child process with blob storage stubbed inside the child - child coverage still counts
// towards this file's numbers
const cliPath = fileURLToPath(new URL('./import-from-blob.ts', import.meta.url));
const databaseDir = fileURLToPath(new URL('../..', import.meta.url));

const blobAreaId = deterministicId('consultee-area:import-blob-test-1');
const blobBoundaryId = deterministicId('case-boundary:ZZIMPORTBLOB:blob.geojson');

let dbClient: PrismaClient;
let dbAvailable = false;
let connectionString: string | undefined;

before(async () => {
	try {
		connectionString = loadConfig().db;
		dbClient = newDatabaseClient(connectionString);
		await dbClient.$queryRaw`SELECT 1 AS probe`;
		dbAvailable = true;
		// the CLI replaces the whole tables it imports, so the files that write the real
		// database take turns rather than run at the same time
		await acquireDbTestLock();
	} catch {
		dbAvailable = false;
	}
});

after(async () => {
	releaseDbTestLock();
	await dbClient?.$disconnect();
});

/**
 * Run the CLI in a child process with `BlobServiceClient.prototype.getContainerClient` stubbed to
 * serve `blobPayload` as the download body, so the whole download -> import path runs without real
 * blob storage. `args` become the child's CLI arguments.
 */
function runCliViaStubbedBlob(blobPayload: string, args: string[], env: Record<string, string> = {}): string {
	const harness = `
		import { BlobServiceClient } from '@azure/storage-blob';
		import { Readable } from 'node:stream';
		BlobServiceClient.prototype.getContainerClient = () => ({
			getBlobClient: () => ({
				download: async () => ({ readableStreamBody: Readable.from([${JSON.stringify(blobPayload)}]) })
			})
		});
		process.argv[1] = ${JSON.stringify(cliPath)};
		process.argv.push(${args.map((arg) => JSON.stringify(arg)).join(', ')});
		await import(${JSON.stringify(pathToFileURL(cliPath).href)});
	`;
	return execFileSync(process.execPath, ['--input-type=module', '--experimental-strip-types', '--eval', harness], {
		cwd: databaseDir,
		env: { ...process.env, ...BLOB_ENV, ...env },
		encoding: 'utf8'
	});
}

function geoJsonFile(features: object[]): string {
	return JSON.stringify({ type: 'FeatureCollection', features });
}

describe('running as a script (requires a local SQL Server - see docker-compose.yml)', () => {
	test('downloads then imports a consultee-areas blob', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');
		// a consultee-areas import replaces the whole table - so only against CI's throwaway
		// database, never a developer's loaded reference data
		if (!process.env.CI && !process.env.TF_BUILD) {
			return t.skip('replaces every consultee area - runs in CI only');
		}

		await dbClient.$executeRaw`DELETE FROM consultee_area WHERE id = ${blobAreaId}`;
		try {
			const payload = geoJsonFile([
				{
					geometry: { type: 'Point', coordinates: [0, 0] },
					properties: { id: 'import-blob-test-1', consultee: 'Blob Trust', consulteeCategory: 'Ambulance Trust' }
				}
			]);
			const stdout = runCliViaStubbedBlob(payload, ['--type=consultee-areas', '--blob=reference.geojson'], {
				SQL_CONNECTION_STRING: connectionString!
			});
			assert.match(stdout, /Downloading reference.geojson from blob storage/);
			assert.match(stdout, /Importing consultee-areas/);
			assert.match(stdout, /1\/1 \(/);
			assert.match(stdout, /Imported 1 rows/);

			const [row] = await dbClient.$queryRaw<{ found: number }[]>`
				SELECT 1 AS found FROM consultee_area WHERE id = ${blobAreaId}
			`;
			assert.equal(row.found, 1);
		} finally {
			await dbClient.$executeRaw`DELETE FROM consultee_area WHERE id = ${blobAreaId}`;
		}
	});

	test('downloads then imports a case-boundaries blob', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		await dbClient.$executeRaw`DELETE FROM case_boundary WHERE id = ${blobBoundaryId}`;
		try {
			const payload = geoJsonFile([
				{
					geometry: { type: 'Point', coordinates: [0, 0] },
					properties: {
						caseReference: 'ZZIMPORTBLOB',
						projectName: 'Blob boundary import',
						fileName: 'blob.geojson',
						receivedDate: '2026-01-01T00:00:00.000Z'
					}
				}
			]);
			const stdout = runCliViaStubbedBlob(payload, ['--type=case-boundaries', '--blob=boundaries.geojson'], {
				SQL_CONNECTION_STRING: connectionString!
			});
			assert.match(stdout, /Importing case-boundaries/);
			assert.match(stdout, /Imported 1 rows/);

			const [row] = await dbClient.$queryRaw<{ found: number }[]>`
				SELECT 1 AS found FROM case_boundary WHERE id = ${blobBoundaryId}
			`;
			assert.equal(row.found, 1);
		} finally {
			await dbClient.$executeRaw`DELETE FROM case_boundary WHERE id = ${blobBoundaryId}`;
		}
	});
});

describe('running as a script (no database needed)', () => {
	test('a --replace run whose file fails to parse still exits cleanly, touching nothing', () => {
		// a well-formed but unreachable connection string - the temp file fails to parse before the
		// replace logic can clear the table or the client can connect, so this needs no real database
		const dummyConnectionString = 'sqlserver://localhost:1;database=x;user=u;password=p';
		try {
			runCliViaStubbedBlob('{ not json', ['--type=consultee-areas', '--blob=bad.geojson', '--replace'], {
				SQL_CONNECTION_STRING: dummyConnectionString
			});
			assert.fail('expected the CLI to exit non-zero');
		} catch (error) {
			const failure = error as { status: number; stdout: string; stderr: string };
			assert.equal(failure.status, 1);
			assert.match(failure.stdout, /replacing existing rows/);
			assert.ok(failure.stderr.length > 0, 'expected the error to be logged to stderr');
		}
	});

	test('does nothing when imported rather than run as a script', () => {
		// an eval-mode import has no argv[1] at all, so the isMain guard stays false
		const stdout = execFileSync(
			process.execPath,
			['--input-type=module', '--eval', `await import(${JSON.stringify(pathToFileURL(cliPath).href)})`],
			{ cwd: databaseDir, encoding: 'utf8' }
		);
		assert.equal(stdout, '');
	});
});
