import { BlobServiceClient } from '@azure/storage-blob';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PrismaClient } from '../client/client.ts';
import { loadConfig } from '../configuration/config.ts';
import { datasetInUse } from '../geospatial/consultee-areas.ts';
import { newDatabaseClient } from '../index.ts';
import type { GroupLoad, LatestGroupLoad } from './consultee-area-groups.ts';
import type { Dataset, FileStore, Manifest } from './promote-reference-data.ts';
import {
	blobFileStore,
	databaseDataset,
	exportQuarter,
	importQuarter,
	MANIFEST_FILE,
	parseManifest,
	parsePromotionArgs,
	PromotionError,
	run
} from './promote-reference-data.ts';
import { groupBySlug } from './reference-data.ts';

const ADMIN = '20261020_administrative_boundaries.geojson';
const PUBLIC = '20261020_public_bodies.geojson';

const FILES: Manifest['files'] = [
	{ group: 'administrative_boundaries', blobName: ADMIN, rowsLoaded: 9_000 },
	{ group: 'public_bodies', blobName: PUBLIC, rowsLoaded: 316 }
];

function load(blobName: string, rowsLoaded: number): LatestGroupLoad {
	return {
		blobName,
		dataDate: new Date('2026-10-20'),
		quarter: '2026Q4',
		rowsLoaded,
		loadedAt: new Date('2026-10-21')
	};
}

/** A database whose quarter `inUse` holds `rows` of each group, as `loads` loaded them. */
function fakeDataset(options: {
	inUse: string[];
	loads?: Map<string, LatestGroupLoad>;
	rows?: Map<string, number>;
	loadedRows?: Record<string, number>;
	waitingFor?: string[];
}) {
	const inUse = [...options.inUse];
	const loaded: string[] = [];
	const used: string[] = [];
	const dataset: Dataset = {
		// each call takes the next answer, staying on the last
		inUse: async () => (inUse.length > 1 ? inUse.shift()! : inUse[0]),
		latestLoads: async () => options.loads ?? new Map(),
		rowCounts: async () => options.rows ?? new Map(),
		stillToLoad: async () => (options.waitingFor ?? []).map((slug) => groupBySlug(slug)!),
		loadGroup: async (_filePath, blobName) => {
			loaded.push(blobName);
			const slug = blobName.slice(9, -'.geojson'.length);
			return {
				group: groupBySlug(slug)!,
				quarter: '2026Q4',
				rowsLoaded: options.loadedRows?.[blobName] ?? 0,
				datasetInUse: '2026Q4',
				waitingFor: []
			} satisfies GroupLoad;
		},
		use: async (quarter) => {
			used.push(quarter);
		}
	};
	return { dataset, loaded, used };
}

function fakeStore(existing: Record<string, 'same' | 'different'> = {}) {
	const downloaded: string[] = [];
	const uploaded: string[] = [];
	const store: FileStore = {
		download: async (blobName, filePath) => {
			downloaded.push(blobName);
			writeFileSync(filePath, `{"name":"${blobName}"}`);
		},
		upload: async (_filePath, blobName) => {
			if (existing[blobName] === 'different') {
				throw new PromotionError(`${blobName} is already there but isn't the same file`);
			}
			uploaded.push(blobName);
			return existing[blobName] === 'same' ? 'unchanged' : 'uploaded';
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
	writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify({ version: 1, quarter: '2026Q4', files }));
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

describe('exportQuarter', () => {
	test("writes the quarter's group files and what each loaded, skipping a group with no data", async () => {
		const { dataset } = fakeDataset({
			inUse: ['2026Q4'],
			loads: new Map([
				['administrative_boundaries', load(ADMIN, 9_000)],
				['public_bodies', load(PUBLIC, 316)]
			]),
			rows: new Map([
				['administrative_boundaries', 9_000],
				['public_bodies', 316],
				['other', 0]
			])
		});
		const { store, downloaded } = fakeStore();

		const manifest = await exportQuarter(dataset, store, '2026Q4', dir);

		assert.deepEqual(downloaded, [ADMIN, PUBLIC]);
		assert.deepEqual(manifest, {
			version: 1,
			quarter: '2026Q4',
			files: [
				{ group: 'administrative_boundaries', blobName: ADMIN, rowsLoaded: 9_000 },
				{ group: 'public_bodies', blobName: PUBLIC, rowsLoaded: 316 }
			]
		});
		assert.deepEqual(JSON.parse(readFileSync(path.join(dir, MANIFEST_FILE), 'utf8')), manifest);
		assert.equal(readFileSync(path.join(dir, PUBLIC), 'utf8'), `{"name":"${PUBLIC}"}`);
	});

	test('promotes only the dataset in use, as it was loaded, and something', async () => {
		const { store, downloaded } = fakeStore();
		await assert.rejects(
			exportQuarter(fakeDataset({ inUse: ['2026Q4'] }).dataset, store, '2026-Q4', dir),
			/isn't a quarter/
		);
		await assert.rejects(
			exportQuarter(fakeDataset({ inUse: ['2026Q3'] }).dataset, store, '2026Q4', dir),
			/this environment uses 2026Q3, not 2026Q4/
		);
		const edited = fakeDataset({
			inUse: ['2026Q4'],
			loads: new Map([['public_bodies', load(PUBLIC, 316)]]),
			rows: new Map([['public_bodies', 300]])
		});
		await assert.rejects(
			exportQuarter(edited.dataset, store, '2026Q4', dir),
			/300 rows in 2026Q4, but its last load .* put in 316/
		);
		const unlogged = fakeDataset({ inUse: ['2026Q4'], rows: new Map([['energy', 12]]) });
		await assert.rejects(
			exportQuarter(unlogged.dataset, store, '2026Q4', dir),
			/Energy has 12 rows in 2026Q4 but no load on record/
		);
		await assert.rejects(
			exportQuarter(fakeDataset({ inUse: ['2026Q4'] }).dataset, store, '2026Q4', dir),
			/nothing to promote/
		);
		assert.deepEqual(downloaded, []);
	});
});

describe('parseManifest', () => {
	const manifest = (files: unknown, quarter = '2026Q4') => JSON.stringify({ version: 1, quarter, files });

	test("accepts export's manifest", () => {
		const text = manifest([{ group: 'public_bodies', blobName: PUBLIC, rowsLoaded: 316 }]);
		assert.deepEqual(parseManifest(text), JSON.parse(text) as Manifest);
	});

	test('refuses anything else', () => {
		assert.throws(() => parseManifest('{"version":2}'), /isn't one export wrote/);
		assert.throws(
			() => parseManifest(manifest([{ group: 'public_bodies', blobName: 'notes.txt', rowsLoaded: 1 }])),
			/isn't a 2026Q4 group file/
		);
		assert.throws(
			() => parseManifest(manifest([{ group: 'energy', blobName: PUBLIC, rowsLoaded: 1 }])),
			/isn't a 2026Q4 group file/
		);
		assert.throws(
			() => parseManifest(manifest([{ group: 'public_bodies', blobName: PUBLIC, rowsLoaded: 1 }], '2027Q1')),
			/isn't a 2027Q1 group file/
		);
		assert.throws(
			() => parseManifest(manifest([{ group: 'public_bodies', blobName: PUBLIC, rowsLoaded: 0 }])),
			/no rows/
		);
	});

	test('refuses a manifest with no quarter or an entry that is not a file', () => {
		assert.throws(() => parseManifest('null'), /isn't one export wrote/);
		assert.throws(() => parseManifest('{"version":1,"files":[]}'), /isn't one export wrote/);
		assert.throws(() => parseManifest(manifest([null])), /isn't a 2026Q4 group file/);
		assert.throws(
			() => parseManifest(manifest([{ group: 'public_bodies', blobName: PUBLIC, rowsLoaded: '316' }])),
			/no rows/
		);
	});
});

describe('importQuarter', () => {
	test('uploads and loads each group, and checks the quarter is now in use', async () => {
		writeExport(FILES);
		const { dataset, loaded, used } = fakeDataset({
			inUse: ['2026Q3', '2026Q4'],
			loadedRows: { [ADMIN]: 9_000, [PUBLIC]: 316 }
		});
		const { store, uploaded } = fakeStore({ [ADMIN]: 'same' });
		const lines: string[] = [];

		await importQuarter(dataset, store, dir, (line) => lines.push(line));

		assert.deepEqual(uploaded, [ADMIN, PUBLIC]);
		assert.deepEqual(loaded, [ADMIN, PUBLIC]);
		assert.deepEqual(used, []);
		assert.deepEqual(lines, [
			`${ADMIN}: already in blob storage`,
			`${PUBLIC}: uploaded`,
			'Administrative boundaries: 9000 rows (9000 on the source)',
			'Public bodies: 316 rows (316 on the source)',
			'2026Q4 is the dataset in use'
		]);
	});

	test('goes back to the dataset it was using when a group loads a different number of rows', async () => {
		writeExport(FILES);
		const { dataset, used } = fakeDataset({
			inUse: ['2026Q3', '2026Q4'],
			loadedRows: { [ADMIN]: 9_000, [PUBLIC]: 300 }
		});

		await assert.rejects(
			importQuarter(dataset, fakeStore().store, dir, () => undefined),
			/Public bodies loaded 300 rows, not 316 .* back on 2026Q3/
		);
		assert.deepEqual(used, ['2026Q3']);
	});

	test("says what it's waiting for when the quarter isn't in use yet, and loads nothing over a different file", async () => {
		writeExport(FILES);
		const waiting = fakeDataset({
			inUse: ['2026Q3'],
			loadedRows: { [ADMIN]: 9_000, [PUBLIC]: 316 },
			waitingFor: ['energy']
		});
		await assert.rejects(
			importQuarter(waiting.dataset, fakeStore().store, dir, () => undefined),
			/still waiting for Energy; this environment still uses 2026Q3/
		);

		const clash = fakeDataset({ inUse: ['2026Q3'] });
		await assert.rejects(
			importQuarter(clash.dataset, fakeStore({ [PUBLIC]: 'different' }).store, dir, () => undefined),
			/isn't the same file/
		);
		assert.deepEqual(clash.loaded, []);
	});

	test('says it is waiting for nothing when the quarter may just be older than the one in use', async () => {
		writeExport(FILES);
		const { dataset } = fakeDataset({
			inUse: ['2026Q3'],
			loadedRows: { [ADMIN]: 9_000, [PUBLIC]: 316 },
			waitingFor: []
		});

		await assert.rejects(
			importQuarter(dataset, fakeStore().store, dir, () => undefined),
			/still waiting for nothing \(it may be older than the dataset in use\)/
		);
	});

	test('reports a load mismatch without switching back when the quarter was already in use', async () => {
		writeExport(FILES);
		const { dataset, used } = fakeDataset({
			inUse: ['2026Q4'],
			loadedRows: { [ADMIN]: 9_000, [PUBLIC]: 300 }
		});

		await assert.rejects(
			importQuarter(dataset, fakeStore().store, dir, () => undefined),
			(error: Error) => {
				assert.match(error.message, /loaded 300 rows, not 316/);
				assert.doesNotMatch(error.message, /back on/);
				return true;
			}
		);
		assert.deepEqual(used, []);
	});
});

describe('parsePromotionArgs', () => {
	test('reads export and import', () => {
		assert.deepEqual(parsePromotionArgs(['export', '--quarter=2026Q4', '--dir=/tmp/x']), {
			command: 'export',
			dir: '/tmp/x',
			quarter: '2026Q4'
		});
		assert.deepEqual(parsePromotionArgs(['import', 'stray', '--dir=/tmp/x']), {
			command: 'import',
			dir: '/tmp/x',
			quarter: undefined
		});
	});

	test('refuses a missing command, directory or quarter', () => {
		assert.throws(() => parsePromotionArgs(['--dir=/tmp/x']), /"export" or "import"/);
		assert.throws(() => parsePromotionArgs(['import']), /--dir is required/);
		assert.throws(() => parsePromotionArgs(['export', '--dir=/tmp/x']), /needs --quarter/);
	});
});

describe('run', () => {
	test('exports the quarter in use and logs the manifest it wrote', async () => {
		const { dataset } = fakeDataset({
			inUse: ['2026Q4'],
			loads: new Map([['public_bodies', load(PUBLIC, 316)]]),
			rows: new Map([['public_bodies', 316]])
		});
		const lines: string[] = [];

		await run(['export', '--quarter=2026Q4', `--dir=${dir}`], dataset, fakeStore().store, (line) => lines.push(line));

		assert.deepEqual(lines, ['Exported 2026Q4:', `  ${PUBLIC}: 316 rows`]);
	});

	test('imports the export in the directory and logs the manifest', async () => {
		writeExport(FILES);
		const { dataset } = fakeDataset({ inUse: ['2026Q4'], loadedRows: { [ADMIN]: 9_000, [PUBLIC]: 316 } });
		const lines: string[] = [];

		await run(['import', `--dir=${dir}`], dataset, fakeStore().store, (line) => lines.push(line));

		assert.deepEqual(lines, [
			`${ADMIN}: uploaded`,
			`${PUBLIC}: uploaded`,
			'Administrative boundaries: 9000 rows (9000 on the source)',
			'Public bodies: 316 rows (316 on the source)',
			'2026Q4 is the dataset in use',
			'Imported 2026Q4:',
			`  ${ADMIN}: 9000 rows`,
			`  ${PUBLIC}: 316 rows`
		]);
	});
});

describe('databaseDataset', () => {
	test('answers the promotion questions from the database', async () => {
		const executed: unknown[][] = [];
		const client = {
			$queryRaw: async (strings: TemplateStringsArray) => {
				const sql = strings.join(' ');
				if (sql.includes('base_object_name')) {
					return [{ baseObjectName: '[dbo].[consultee_area_2026Q4]' }];
				}
				if (sql.includes('COUNT')) {
					return [{ count: 3 }];
				}
				return [];
			},
			$executeRaw: async (...args: unknown[]) => {
				executed.push(args);
				return 0;
			}
		} as unknown as PrismaClient;

		const dataset = databaseDataset(client);

		assert.equal(await dataset.inUse(), '2026Q4');
		assert.deepEqual(await dataset.latestLoads('2026Q4'), new Map());
		const counts = await dataset.rowCounts('2026Q4');
		assert.ok(counts.size > 0);
		assert.ok([...counts.values()].every((count) => count === 3));
		assert.deepEqual(await dataset.stillToLoad('2026Q4'), []);
		await dataset.use('2026Q4');
		assert.equal(executed.length, 1);
		assert.ok(executed[0].includes('2026Q4'));
		await assert.rejects(() => dataset.loadGroup('/tmp/nope.geojson', 'notes.txt'), /isn't a group's file/);
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

	test('leaves a file already in the container alone, and refuses a different one', async () => {
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
				await assert.rejects(() => blobFileStore().upload(filePath, 'b.geojson'), /isn't the same file/);
			});
		} finally {
			different.getContainerClient.mock.restore();
		}
	});
});

// the isMain block only runs as a script, so this spawns the real CLI in a child process - child
// coverage still counts towards this file's numbers. The seeded database's consultee areas have no
// load on record, so the export fails with the PromotionError the run logs
const cliPath = fileURLToPath(new URL('./promote-reference-data.ts', import.meta.url));

let dbClient: PrismaClient;
let dbAvailable = false;
let connectionString: string | undefined;

before(async () => {
	try {
		connectionString = loadConfig().db;
		dbClient = newDatabaseClient(connectionString);
		await dbClient.$queryRaw`SELECT 1 AS probe`;
		dbAvailable = true;
	} catch {
		dbAvailable = false;
	}
});

after(async () => {
	await dbClient?.$disconnect();
});

describe('running as a script (requires a local SQL Server - see docker-compose.yml)', () => {
	test('imports a manifest with nothing to load, logging what it did', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');
		// an empty manifest for the quarter already in use promotes successfully, changing nothing
		const quarter = await datasetInUse(dbClient);
		writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify({ version: 1, quarter, files: [] }));

		const stdout = execFileSync(process.execPath, ['--experimental-strip-types', cliPath, 'import', `--dir=${dir}`], {
			env: { ...process.env, SQL_CONNECTION_STRING: connectionString!, ...BLOB_ENV },
			encoding: 'utf8'
		});

		assert.match(stdout, new RegExp(`${quarter} is the dataset in use`));
		assert.match(stdout, new RegExp(`Imported ${quarter}:`));
	});

	test('fails with the PromotionError a real export raises', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');
		try {
			execFileSync(
				process.execPath,
				['--experimental-strip-types', cliPath, 'export', '--quarter=2026Q4', `--dir=${dir}`],
				{
					env: { ...process.env, SQL_CONNECTION_STRING: connectionString!, ...BLOB_ENV },
					encoding: 'utf8'
				}
			);
			assert.fail('expected the export to exit non-zero');
		} catch (error) {
			const failure = error as { status: number; stderr: string };
			assert.equal(failure.status, 1);
			assert.match(failure.stderr, /PromotionError/);
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
