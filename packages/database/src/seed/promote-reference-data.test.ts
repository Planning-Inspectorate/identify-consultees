import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { GroupLoad, LatestGroupLoad } from './consultee-area-groups.ts';
import type { Dataset, FileStore, Manifest } from './promote-reference-data.ts';
import {
	exportQuarter,
	importQuarter,
	MANIFEST_FILE,
	parseManifest,
	parsePromotionArgs,
	PromotionError
} from './promote-reference-data.ts';
import { groupBySlug } from './reference-data.ts';

const ADMIN = '20261020_administrative_boundaries.geojson';
const PUBLIC = '20261020_public_bodies.geojson';

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
});

describe('importQuarter', () => {
	function writeExport(files: Manifest['files']) {
		writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify({ version: 1, quarter: '2026Q4', files }));
		for (const file of files) {
			writeFileSync(path.join(dir, file.blobName), '{}');
		}
	}
	const FILES = [
		{ group: 'administrative_boundaries', blobName: ADMIN, rowsLoaded: 9_000 },
		{ group: 'public_bodies', blobName: PUBLIC, rowsLoaded: 316 }
	];

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
