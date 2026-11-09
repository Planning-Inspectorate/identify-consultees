import { BlobServiceClient } from '@azure/storage-blob';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { StoredBlob } from './import-from-blob.ts';
import type { FileStore, Manifest } from './promote-reference-data.ts';
import {
	blobFileStore,
	copyFiles,
	exportFiles,
	MANIFEST_FILE,
	parseManifest,
	parsePromotionArgs,
	run
} from './promote-reference-data.ts';

const ADMIN = '20261020_administrative_boundaries.geojson';
const PUBLIC = '20261020_public_bodies.geojson';

const FILES: Manifest['files'] = [
	{ group: 'administrative_boundaries', blobName: ADMIN, size: 9_000 },
	{ group: 'public_bodies', blobName: PUBLIC, size: 316 }
];

const stored = (name: string, size = 1): StoredBlob => ({ name, size, lastModified: new Date('2026-10-21') });

function fakeStore(blobs: StoredBlob[] = [], existing: Record<string, 'same' | 'different'> = {}) {
	const downloaded: string[] = [];
	const uploaded: string[] = [];
	const store: FileStore = {
		list: async () => blobs,
		download: async (blobName, filePath) => {
			downloaded.push(blobName);
			writeFileSync(filePath, `{"name":"${blobName}"}`);
		},
		upload: async (_filePath, blobName) => {
			uploaded.push(blobName);
			return existing[blobName] === 'same' ? 'unchanged' : existing[blobName] === 'different' ? 'replaced' : 'uploaded';
		}
	};
	return { store, downloaded, uploaded };
}

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'promote-reference-data-'));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** The export `files` describes, written to the test's `dir`. */
function writeExport(files: Manifest['files']) {
	writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify({ version: 2, files }));
	for (const file of files) {
		writeFileSync(path.join(dir, file.blobName), '{}');
	}
}

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

describe('exportFiles', () => {
	test("writes each group's newest file and their manifest, leaving out older files and other files", async () => {
		const { store, downloaded } = fakeStore([
			stored('20260715_public_bodies.geojson'),
			stored(PUBLIC, 316),
			stored(ADMIN, 9_000),
			stored('notes.txt')
		]);

		const manifest = await exportFiles(store, dir);

		assert.deepEqual(downloaded, [ADMIN, PUBLIC]);
		assert.deepEqual(manifest, { version: 2, files: FILES });
		assert.deepEqual(JSON.parse(readFileSync(path.join(dir, MANIFEST_FILE), 'utf8')), manifest);
		assert.equal(readFileSync(path.join(dir, PUBLIC), 'utf8'), `{"name":"${PUBLIC}"}`);
	});

	test('refuses when there are no group files to copy', async () => {
		const { store, downloaded } = fakeStore([stored('notes.txt')]);
		await assert.rejects(exportFiles(store, dir), /nothing to copy/);
		assert.deepEqual(downloaded, []);
	});
});

describe('parseManifest', () => {
	const manifest = (files: unknown) => JSON.stringify({ version: 2, files });

	test("accepts export's manifest", () => {
		const text = manifest(FILES);
		assert.deepEqual(parseManifest(text), JSON.parse(text) as Manifest);
	});

	test('refuses anything else', () => {
		assert.throws(() => parseManifest('null'), /isn't one export wrote/);
		assert.throws(() => parseManifest('{"version":1,"quarter":"2026Q4","files":[]}'), /isn't one export wrote/);
		assert.throws(() => parseManifest('{"version":2}'), /isn't one export wrote/);
		assert.throws(() => parseManifest(manifest([null])), /isn't a group's file/);
		assert.throws(
			() => parseManifest(manifest([{ group: 'public_bodies', blobName: 'notes.txt', size: 1 }])),
			/notes.txt, which isn't a group's file/
		);
		assert.throws(
			() => parseManifest(manifest([{ group: 'energy', blobName: PUBLIC, size: 1 }])),
			/isn't a group's file/
		);
	});
});

describe('copyFiles', () => {
	test("uploads each group's file, saying which were there already and which it replaced", async () => {
		writeExport([...FILES, { group: 'energy', blobName: '20261020_energy.geojson', size: 5 }]);
		const { store, uploaded } = fakeStore([], { [ADMIN]: 'same', '20261020_energy.geojson': 'different' });
		const lines: string[] = [];

		const manifest = await copyFiles(store, dir, (line) => lines.push(line));

		assert.equal(manifest.files.length, 3);
		assert.deepEqual(uploaded, [ADMIN, PUBLIC, '20261020_energy.geojson']);
		assert.deepEqual(lines, [
			`${ADMIN}: already in blob storage`,
			`${PUBLIC}: copied`,
			'20261020_energy.geojson: copied, replacing a different file of the same name'
		]);
	});
});

describe('parsePromotionArgs', () => {
	test('reads export and copy, ignoring anything else', () => {
		assert.deepEqual(parsePromotionArgs(['export', '--dir=/tmp/x']), { command: 'export', dir: '/tmp/x' });
		assert.deepEqual(parsePromotionArgs(['copy', 'stray', '--quarter=', '--dir=/tmp/x']), {
			command: 'copy',
			dir: '/tmp/x'
		});
	});

	test('refuses a missing command or directory', () => {
		assert.throws(() => parsePromotionArgs(['--dir=/tmp/x']), /"export" or "copy"/);
		assert.throws(() => parsePromotionArgs(['import', '--dir=/tmp/x']), /"export" or "copy"/);
		assert.throws(() => parsePromotionArgs(['copy']), /--dir is required/);
	});
});

describe('run', () => {
	test('exports and logs the files it wrote', async () => {
		const lines: string[] = [];
		await run(['export', `--dir=${dir}`], fakeStore([stored(PUBLIC)]).store, (line) => lines.push(line));
		assert.deepEqual(lines, ['Exported:', `  ${PUBLIC}`]);
	});

	test('copies the export in the directory and logs the files', async () => {
		writeExport(FILES);
		const lines: string[] = [];
		await run(['copy', `--dir=${dir}`], fakeStore().store, (line) => lines.push(line));
		assert.deepEqual(lines, [`${ADMIN}: copied`, `${PUBLIC}: copied`, 'Copied:', `  ${ADMIN}`, `  ${PUBLIC}`]);
	});
});

describe('blobFileStore', () => {
	// a stand-in container client lets the download/upload paths run without real blob storage
	function stubContainer(blob: { exists: boolean; contentLength?: number }) {
		const uploaded: string[] = [];
		const getContainerClient = mock.method(BlobServiceClient.prototype, 'getContainerClient', () => ({
			containerName: 'test-container',
			getBlobClient: () => ({
				downloadToFile: async (filePath: string) => writeFileSync(filePath, '{"downloaded":true}')
			}),
			listBlobsFlat: async function* () {
				yield { name: 'a.geojson', properties: { contentLength: 3, lastModified: new Date('2026-10-21') } };
			},
			getBlockBlobClient: () => ({
				exists: async () => blob.exists,
				getProperties: async () => ({ contentLength: blob.contentLength ?? 0 }),
				uploadFile: async () => uploaded.push('file')
			})
		}));
		return { getContainerClient, uploaded };
	}

	test('downloads a blob and uploads a file that is not there yet', async () => {
		const { getContainerClient, uploaded } = stubContainer({ exists: false });
		try {
			await withBlobEnv(BLOB_ENV.BLOB_STORE_HOST, BLOB_ENV.BLOB_STORE_CONTAINER, async () => {
				const store = blobFileStore();
				assert.deepEqual(await store.list(), [{ name: 'a.geojson', size: 3, lastModified: new Date('2026-10-21') }]);
				const target = path.join(dir, 'a.geojson');
				await store.download('a.geojson', target);
				assert.equal(readFileSync(target, 'utf8'), '{"downloaded":true}');

				writeFileSync(target, 'data');
				assert.equal(await store.upload(target, 'a.geojson'), 'uploaded');
				assert.equal(uploaded.length, 1);
			});
		} finally {
			getContainerClient.mock.restore();
		}
	});

	test('leaves the same file already in the container alone, and replaces a different one', async () => {
		const filePath = path.join(dir, 'b.geojson');
		writeFileSync(filePath, 'data');

		const same = stubContainer({ exists: true, contentLength: 4 });
		try {
			await withBlobEnv(BLOB_ENV.BLOB_STORE_HOST, BLOB_ENV.BLOB_STORE_CONTAINER, async () => {
				assert.equal(await blobFileStore().upload(filePath, 'b.geojson'), 'unchanged');
			});
		} finally {
			same.getContainerClient.mock.restore();
		}

		const different = stubContainer({ exists: true, contentLength: 999 });
		try {
			await withBlobEnv(BLOB_ENV.BLOB_STORE_HOST, BLOB_ENV.BLOB_STORE_CONTAINER, async () => {
				assert.equal(await blobFileStore().upload(filePath, 'b.geojson'), 'replaced');
			});
			assert.equal(different.uploaded.length, 1);
		} finally {
			different.getContainerClient.mock.restore();
		}
	});
});

// the isMain block only runs as a script, so this spawns the real CLI in a child process - child
// coverage still counts towards this file's numbers
const cliPath = fileURLToPath(new URL('./promote-reference-data.ts', import.meta.url));

describe('running as a script', () => {
	test('copies a manifest with nothing to copy, logging what it did', () => {
		writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify({ version: 2, files: [] }));

		const stdout = execFileSync(process.execPath, ['--experimental-strip-types', cliPath, 'copy', `--dir=${dir}`], {
			env: { ...process.env, ...BLOB_ENV },
			encoding: 'utf8'
		});

		assert.match(stdout, /Copied:/);
	});

	test('fails when there is no export to copy', () => {
		try {
			execFileSync(process.execPath, ['--experimental-strip-types', cliPath, 'copy', `--dir=${dir}`], {
				env: { ...process.env, ...BLOB_ENV },
				encoding: 'utf8',
				stdio: 'pipe'
			});
			assert.fail('expected the copy to exit non-zero');
		} catch (error) {
			const failure = error as { status: number; stderr: string };
			assert.equal(failure.status, 1);
			assert.match(failure.stderr, /ENOENT/);
		}
	});

	test('does nothing when imported rather than run as a script', () => {
		const stdout = execFileSync(
			process.execPath,
			['--input-type=module', '--eval', `await import(${JSON.stringify(pathToFileURL(cliPath).href)})`],
			{ encoding: 'utf8' }
		);
		assert.equal(stdout, '');
	});
});
