import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { after, before, describe, mock, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PrismaClient } from '../client/client.ts';
import { loadConfig } from '../configuration/config.ts';
import { newDatabaseClient } from '../index.ts';
import type { GroupLoad, LatestGroupLoad } from './consultee-area-groups.ts';
import { GroupLoadError } from './consultee-area-groups.ts';
import type { StoredBlob } from './import-from-blob.ts';
import type { Database, Files } from './load-reference-data.ts';
import { LoadError, loadReferenceData, main, parseLoadArgs, sqlDatabase } from './load-reference-data.ts';

const ADMIN = '20261020_administrative_boundaries.geojson';
const PUBLIC = '20261020_public_bodies.geojson';
const LOADED_AT = new Date('2026-10-22T09:00:00Z');

const stored = (name: string, lastModified = new Date('2026-10-21T09:00:00Z')): StoredBlob => ({
	name,
	size: 1,
	lastModified
});

const lastLoad = (blobName: string, rowsLoaded: number): LatestGroupLoad => ({
	blobName,
	dataDate: new Date('2026-10-20'),
	quarter: '2026Q4',
	rowsLoaded,
	loadedAt: LOADED_AT
});

/** A database whose 2026Q4 holds `rows` of each group, as `loads` loaded them. */
function fakeDatabase(
	options: {
		quarters?: string[];
		loads?: Map<string, LatestGroupLoad>;
		rows?: Map<string, number>;
		refuse?: Record<string, unknown>;
	} = {}
) {
	const imported: string[] = [];
	const cleared: string[] = [];
	const db: Database = {
		quarters: async () => options.quarters ?? ['2026Q4'],
		inUse: async () => '2026Q4',
		latestLoads: async () => options.loads ?? new Map(),
		rowCounts: async () => options.rows ?? new Map(),
		importGroup: async (_filePath, blobName) => {
			if (options.refuse?.[blobName] !== undefined) {
				throw options.refuse[blobName];
			}
			imported.push(blobName);
			return { quarter: '2026Q4', rowsLoaded: 10 } as GroupLoad;
		},
		clear: async (quarter) => {
			cleared.push(quarter);
			return 25;
		}
	};
	return { db, imported, cleared };
}

function fakeFiles(blobs: StoredBlob[]) {
	const cleanup = mock.fn(async () => {});
	const files: Files = {
		list: async () => blobs,
		download: async (blobName) => ({ filePath: `/tmp/${blobName}`, cleanup })
	};
	return { files, cleanup };
}

describe('parseLoadArgs', () => {
	test('loads by default, and clears a quarter first when asked', () => {
		assert.deepEqual(parseLoadArgs([]), { clear: undefined, load: true });
		// the pipeline's default, a blank quarter, clears nothing
		assert.deepEqual(parseLoadArgs(['--clear= ']), { clear: undefined, load: true });
		assert.deepEqual(parseLoadArgs(['--clear=2026Q4']), { clear: '2026Q4', load: true });
		assert.deepEqual(parseLoadArgs(['--clear=2026Q4', '--no-load']), { clear: '2026Q4', load: false });
	});

	test('refuses anything else', () => {
		assert.throws(() => parseLoadArgs(['--quarter=2026Q4']), /"--quarter=2026Q4" isn't an option/);
		assert.throws(() => parseLoadArgs(['--clear=2026-Q4']), /isn't a quarter/);
		assert.throws(() => parseLoadArgs(['--no-load']), /does nothing/);
		assert.throws(() => parseLoadArgs(['--clear=', '--no-load']), LoadError);
	});
});

describe('loadReferenceData', () => {
	test("loads each group's newest file, skipping a group with none, and says what's in use", async () => {
		const { db, imported } = fakeDatabase();
		const { files, cleanup } = fakeFiles([stored('20260715_public_bodies.geojson'), stored(PUBLIC), stored(ADMIN)]);
		const lines: string[] = [];

		await loadReferenceData(db, files, { load: true }, (line) => lines.push(line));

		assert.deepEqual(imported, [ADMIN, PUBLIC]);
		assert.equal(cleanup.mock.callCount(), 2);
		assert.ok(lines.includes(`Administrative boundaries: loaded ${ADMIN} into 2026Q4 - 10 consultee areas`));
		assert.ok(lines.includes('Energy: no file in blob storage - skipped'));
		assert.equal(lines.at(-1), 'The dataset in use is 2026Q4');
	});

	test('skips a group already loaded from its newest file, but loads one changed or edited since', async () => {
		const { db, imported } = fakeDatabase({
			loads: new Map([
				['administrative_boundaries', lastLoad(ADMIN, 9_000)],
				['public_bodies', lastLoad(PUBLIC, 316)],
				['energy', lastLoad('20261020_energy.geojson', 40)]
			]),
			rows: new Map([
				['administrative_boundaries', 9_000],
				['public_bodies', 300],
				['energy', 40]
			])
		});
		const { files } = fakeFiles([
			stored(ADMIN),
			stored(PUBLIC),
			// uploaded again, corrected, after it was loaded
			stored('20261020_energy.geojson', new Date('2026-10-23T09:00:00Z'))
		]);
		const lines: string[] = [];

		await loadReferenceData(db, files, { load: true }, (line) => lines.push(line));

		assert.deepEqual(imported, [PUBLIC, '20261020_energy.geojson']);
		assert.ok(lines.includes(`Administrative boundaries: ${ADMIN} is already loaded into 2026Q4 - skipped`));
	});

	test('clears a quarter first, and only clears when told not to load', async () => {
		const both = fakeDatabase();
		const lines: string[] = [];
		await loadReferenceData(both.db, fakeFiles([stored(PUBLIC)]).files, { clear: '2026Q4', load: true }, (line) =>
			lines.push(line)
		);
		assert.deepEqual(both.cleared, ['2026Q4']);
		assert.deepEqual(both.imported, [PUBLIC]);
		assert.equal(lines[0], 'Cleared 2026Q4: 25 consultee areas');

		const clearOnly = fakeDatabase();
		const list = mock.fn(async () => []);
		await loadReferenceData(clearOnly.db, { list, download: assert.fail }, { clear: '2026Q4', load: false }, () => {});
		assert.deepEqual(clearOnly.cleared, ['2026Q4']);
		assert.equal(list.mock.callCount(), 0);
	});

	test("refuses to clear a quarter there's no dataset for", async () => {
		const { db, cleared } = fakeDatabase({ quarters: ['2026Q3'] });
		await assert.rejects(
			loadReferenceData(db, fakeFiles([]).files, { clear: '2026Q4', load: true }, () => {}),
			/There's no 2026Q4 dataset to clear/
		);
		assert.deepEqual(cleared, []);
	});

	test('loads the other groups when one fails, then fails naming it', async () => {
		const { db, imported } = fakeDatabase({
			refuse: {
				[ADMIN]: new GroupLoadError('it has a feature from another group'),
				'20261020_energy.geojson': 'offline'
			}
		});
		const { files, cleanup } = fakeFiles([stored(ADMIN), stored(PUBLIC), stored('20261020_energy.geojson')]);
		const lines: string[] = [];

		await assert.rejects(
			loadReferenceData(db, files, { load: true }, (line) => lines.push(line)),
			/Couldn't load Administrative boundaries, Energy - see above/
		);

		assert.deepEqual(imported, [PUBLIC]);
		assert.equal(cleanup.mock.callCount(), 3);
		assert.ok(
			lines.includes(`Administrative boundaries: couldn't load ${ADMIN} - it has a feature from another group`)
		);
		assert.ok(lines.includes("Energy: couldn't load 20261020_energy.geojson - offline"));
	});
});

/** A database client that answers as one holding a 2026Q4 dataset, three rows to a group. */
function fakeClient() {
	return {
		$queryRaw: async (strings: TemplateStringsArray) => {
			const sql = strings.join(' ');
			if (sql.includes('base_object_name')) {
				return [{ baseObjectName: '[dbo].[consultee_area_2026Q4]' }];
			}
			if (sql.includes('sys.tables')) {
				return [{ name: 'consultee_area_2026Q4', rows: 5 }];
			}
			if (sql.includes('COUNT')) {
				return [{ count: 3 }];
			}
			return [];
		},
		$executeRaw: async () => 0,
		$disconnect: mock.fn(async () => {})
	};
}

describe('main', () => {
	test("runs what it's asked against the database it opens, then closes it", async () => {
		const client = fakeClient();
		const lines: string[] = [];
		await main(
			['--clear=2026Q4', '--no-load'],
			() => client as unknown as PrismaClient,
			fakeFiles([]).files,
			(line) => lines.push(line)
		);
		assert.deepEqual(lines, ['Cleared 2026Q4: 0 consultee areas', 'The dataset in use is 2026Q4']);
		assert.equal(client.$disconnect.mock.callCount(), 1);
	});
});

describe('sqlDatabase', () => {
	test('answers from the database', async () => {
		const db = sqlDatabase(fakeClient() as unknown as PrismaClient);

		assert.deepEqual(await db.quarters(), ['2026Q4']);
		assert.equal(await db.inUse(), '2026Q4');
		assert.deepEqual(await db.latestLoads('2026Q4'), new Map());
		assert.ok([...(await db.rowCounts('2026Q4')).values()].every((count) => count === 3));
		assert.equal(await db.clear('2026Q4'), 0);
		// refused on its name, before it touches the database
		await assert.rejects(db.importGroup('/tmp/notes.txt', 'notes.txt'), GroupLoadError);
	});
});

// the isMain block only runs as a script, so this spawns the real CLI in a child process - child
// coverage still counts towards this file's numbers
const cliPath = fileURLToPath(new URL('./load-reference-data.ts', import.meta.url));

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

function runCli(args: string[], env: NodeJS.ProcessEnv) {
	try {
		execFileSync(process.execPath, ['--experimental-strip-types', cliPath, ...args], {
			env,
			encoding: 'utf8',
			stdio: 'pipe'
		});
		return assert.fail('expected the load to exit non-zero');
	} catch (error) {
		return error as { status: number; stderr: string };
	}
}

describe('running as a script (requires a local SQL Server - see docker-compose.yml)', () => {
	test('fails on an option it does not know, before opening the database', () => {
		const failure = runCli(['--quarter=2026Q4'], process.env);
		assert.equal(failure.status, 1);
		assert.match(failure.stderr, /LoadError/);
	});

	test("fails with the LoadError a clear of a quarter there's no dataset for raises", async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');
		// a quarter long before any dataset: refused before anything is cleared or loaded
		const failure = runCli(['--clear=1999Q1', '--no-load'], {
			...process.env,
			SQL_CONNECTION_STRING: connectionString!
		});
		assert.equal(failure.status, 1);
		assert.match(failure.stderr, /There's no 1999Q1 dataset to clear/);
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
