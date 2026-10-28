import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, mock, test } from 'node:test';
import type { PrismaClient } from '../client/client.ts';
import { loadConfig } from '../configuration/config.ts';
import { acquireDbTestLock, releaseDbTestLock } from '../db-test-lock.ts';
import { datasetInUse, listDatasets } from '../geospatial/consultee-areas.ts';
import { newDatabaseClient } from '../index.ts';
import {
	clearConsulteeAreas,
	dateFromFileName,
	groupBlobName,
	GroupLoadError,
	groupRowCounts,
	groupsStillToLoad,
	importConsulteeAreaGroup,
	isoDate,
	latestGroupLoads,
	parseGroupBlobName,
	quarterOf
} from './consultee-area-groups.ts';
import { CLEAR_BATCH_SIZE } from './geojson-import.ts';
import { groupBySlug, parseReferenceDataConfig, REFERENCE_DATA_CONFIG } from './reference-data.ts';

describe('group files', () => {
	const publicBodies = groupBySlug('public_bodies')!;

	test("are named for the date their data is from, then the group's slug", () => {
		assert.equal(groupBlobName(publicBodies, '2026-10-20'), '20261020_public_bodies.geojson');
		assert.deepEqual(parseGroupBlobName('20261020_public_bodies.geojson'), {
			group: publicBodies,
			dataDate: '2026-10-20'
		});
	});

	test("aren't any other name, an unknown group, or a date that doesn't exist", () => {
		for (const name of [
			'combined_reference_data_v1.geojson',
			'20261020_combined_reference_data.geojson',
			'20261020_public_bodies.json',
			'2026102_public_bodies.geojson',
			'20261340_public_bodies.geojson',
			'20260230_public_bodies.geojson'
		]) {
			assert.equal(parseGroupBlobName(name), undefined, name);
		}
	});

	test('take their date from a form, or from the start of the file name', () => {
		assert.equal(isoDate('20', '10', '2026'), '2026-10-20');
		assert.equal(isoDate(' 1', '2 ', '2026'), '2026-02-01');
		for (const [day, month, year] of [
			['', '', ''],
			['31', '2', '2026'],
			['1', '1', '26'],
			['x', '1', '2026'],
			[undefined, '1', '2026']
		]) {
			assert.equal(isoDate(day, month, year), undefined, `${day}/${month}/${year}`);
		}
		assert.equal(dateFromFileName('20261020_combined_public_bodies.geojson'), '2026-10-20');
		assert.equal(dateFromFileName('20261399_public_bodies.geojson'), undefined);
		assert.equal(dateFromFileName('public_bodies.geojson'), undefined);
	});

	test('give the quarter their data is from', () => {
		assert.equal(quarterOf('2026-01-01'), '2026Q1');
		assert.equal(quarterOf('2026-03-31'), '2026Q1');
		assert.equal(quarterOf('2026-04-01'), '2026Q2');
		assert.equal(quarterOf('2026-09-30'), '2026Q3');
		assert.equal(quarterOf('2026-10-20'), '2026Q4');
	});
});

// categories of their own, so loading the group can only ever replace this suite's rows
const CONFIG = parseReferenceDataConfig(`
version: 1
datasets:
  ZZT_EW: Groups Test Area
groups:
  Groups Test: [Groups Test Area]
  Groups Other: [Groups Other Area]
`);
// a quarter of its own, far from any real one: its table is made, used, and dropped by the suite
const NEXT = '2099Q4';

let dbClient: PrismaClient;
let dbAvailable = false;
let dir: string;
let inUseBefore: string;

before(async () => {
	dir = await mkdtemp(path.join(tmpdir(), 'consultee-area-groups-'));
	try {
		dbClient = newDatabaseClient(loadConfig().db);
		await dbClient.$queryRaw`SELECT 1 AS probe`;
		dbAvailable = true;
		await acquireDbTestLock();
		inUseBefore = await datasetInUse(dbClient);
	} catch {
		dbAvailable = false;
	}
});

after(async () => {
	if (dbAvailable) {
		await cleanup();
	}
	releaseDbTestLock();
	await dbClient?.$disconnect();
	await rm(dir, { recursive: true, force: true });
});

/** This suite's rows, its quarter's table and its loads gone - and the dataset in use as it was. */
async function cleanup() {
	await dbClient.$executeRaw`EXEC dbo.use_consultee_area_dataset ${inUseBefore}`;
	await dbClient.$executeRaw`DELETE FROM consultee_area WHERE consulteeCategory IN ('Groups Test Area', 'Groups Other Area')`;
	await dbClient.$executeRaw`IF OBJECT_ID('dbo.consultee_area_2099Q4', 'U') IS NOT NULL DROP TABLE dbo.consultee_area_2099Q4`;
	await dbClient.$executeRaw`DELETE FROM reference_data_load WHERE dataGroup IN ('groups_test', 'groups_other')`;
}

/** A file for `slug`'s group dated the first day of the dataset in use's quarter. */
function inUseFile(slug: string): string {
	const month = String((Number(inUseBefore.slice(5)) - 1) * 3 + 1).padStart(2, '0');
	return `${inUseBefore.slice(0, 4)}${month}01_${slug}.geojson`;
}

/** A group's file of `ids`, each a point of `category` - written to the suite's folder as `name`. */
async function groupFile(name: string, ids: string[], category = 'Groups Test Area'): Promise<string> {
	const filePath = path.join(dir, name);
	await writeFile(
		filePath,
		JSON.stringify({
			type: 'FeatureCollection',
			features: ids.map((id) => ({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [-30.5, 45.5] },
				properties: { id, consulteeCategory: category, consultee: `Consultee ${id}`, metadata: { CODE: id } }
			}))
		})
	);
	return filePath;
}

async function load(name: string, ids: string[], category?: string) {
	return importConsulteeAreaGroup(dbClient, await groupFile(name, ids, category), name, { config: CONFIG });
}

/** The suite's rows in `table` - the dataset in use by default. */
async function sourceIds(table = 'consultee_area', category = 'Groups Test Area') {
	const rows = await dbClient.$queryRawUnsafe<{ sourceId: string }[]>(
		`SELECT sourceId FROM ${table} WHERE consulteeCategory = '${category}' ORDER BY sourceId`
	);
	return rows.map((row) => row.sourceId);
}

describe('loading a group (requires a local SQL Server - see docker-compose.yml)', () => {
	test("replaces the group's rows in the dataset in use, when the file is from its quarter", async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');
		await cleanup();
		// a row over a statement's batch, so the replace's deletes take a second pass
		const first = await load(
			inUseFile('groups_test'),
			Array.from({ length: 26 }, (_, i) => `groups-${i}`)
		);
		assert.deepEqual(
			{ ...first, group: first.group.slug },
			{ group: 'groups_test', quarter: inUseBefore, rowsLoaded: 26, datasetInUse: inUseBefore, waitingFor: [] }
		);
		// a corrected file for the same quarter replaces it
		const corrected = inUseFile('groups_test').replace(/01_groups/, '15_groups');
		await load(corrected, ['groups-c']);
		assert.deepEqual(await sourceIds(), ['groups-c']);

		const latest = (await latestGroupLoads(dbClient, inUseBefore)).get('groups_test');
		assert.equal(latest?.blobName, corrected);
		assert.equal(latest?.rowsLoaded, 1);
		assert.deepEqual(
			[...(await groupRowCounts(dbClient, CONFIG))],
			[
				['groups_test', 1],
				['groups_other', 0]
			]
		);
	});

	test('loads a newer quarter into its own table, and uses it once every group with data is in', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');
		await cleanup();
		try {
			// both groups have data in the dataset in use
			await load(inUseFile('groups_test'), ['groups-old']);
			await load(inUseFile('groups_other'), ['other-old'], 'Groups Other Area');

			// the next quarter's first group goes into its own table; the tool keeps using this one
			const testGroup = await load('20991015_groups_test.geojson', ['groups-new']);
			assert.equal(testGroup.quarter, NEXT);
			assert.equal(testGroup.datasetInUse, inUseBefore);
			assert.deepEqual(
				testGroup.waitingFor.map((group) => group.slug),
				['groups_other']
			);
			assert.deepEqual(await sourceIds(`consultee_area_${NEXT}`), ['groups-new']);
			assert.deepEqual(await sourceIds(), ['groups-old']);
			assert.deepEqual(
				(await groupsStillToLoad(dbClient, NEXT, CONFIG)).map((group) => group.slug),
				['groups_other']
			);
			assert.ok((await listDatasets(dbClient)).some((dataset) => dataset.quarter === NEXT && dataset.rows === 1));

			// its last group: the next quarter is the dataset in use, and the last one kept as it was
			const otherGroup = await load('20991020_groups_other.geojson', ['other-new'], 'Groups Other Area');
			assert.equal(otherGroup.datasetInUse, NEXT);
			assert.deepEqual(otherGroup.waitingFor, []);
			assert.equal(await datasetInUse(dbClient), NEXT);
			assert.deepEqual(await sourceIds(), ['groups-new']);
			assert.deepEqual(await sourceIds(`consultee_area_${inUseBefore}`), ['groups-old']);

			// clearing a quarter's dataset by name empties just its table
			assert.equal(await clearConsulteeAreas(dbClient, NEXT), 2);
			assert.deepEqual(await sourceIds(`consultee_area_${NEXT}`), []);
			assert.deepEqual(await sourceIds(`consultee_area_${inUseBefore}`), ['groups-old']);

			// and with no quarter it clears the dataset in use - the suite's own table right
			// now, so the shared local one still isn't touched
			await load('20991021_groups_test.geojson', ['groups-again']);
			assert.equal(await clearConsulteeAreas(dbClient), 1);
			assert.deepEqual(await sourceIds(), []);
			assert.deepEqual(await sourceIds(`consultee_area_${inUseBefore}`), ['groups-old']);
		} finally {
			await cleanup();
		}
		assert.equal(await datasetInUse(dbClient), inUseBefore);
	});

	test("refuses an earlier quarter than the one in use, another group's category, an empty file or a name that isn't a group's - changing nothing", async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');
		await cleanup();
		const file = inUseFile('groups_test');
		await load(file, ['groups-a']);

		for (const [name, ids, category, message] of [
			[
				'20000101_groups_test.geojson',
				['groups-x'],
				undefined,
				new RegExp(`is from 2000Q1, earlier than the dataset in use, ${inUseBefore}`)
			],
			[
				file,
				['groups-x'],
				'Groups Other Area',
				/groups-x, a Groups Other Area, which belongs in Groups Other - not Groups Test/
			],
			[file, ['groups-x'], 'Unheard Of', /a Unheard Of, which config\/reference-data.yaml doesn't put in a group/],
			[file, [], undefined, /holds no consultee areas/],
			['groups_test.geojson', ['groups-x'], undefined, /isn't a group's file/]
		] as const) {
			await assert.rejects(
				() => load(name, [...ids], category),
				(error: Error) => error instanceof GroupLoadError && message.test(error.message),
				name
			);
		}
		assert.deepEqual(await sourceIds(), ['groups-a']);
	});

	test('refuses a feature with no category or id, naming it a feature with no category', async () => {
		// needs no database - the feature is refused while the file is read, before its table is touched
		const name = '20260101_groups_test.geojson';
		const filePath = path.join(dir, name);
		await writeFile(
			filePath,
			JSON.stringify({
				type: 'FeatureCollection',
				features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-30.5, 45.5] }, properties: {} }]
			})
		);
		await assert.rejects(
			() => importConsulteeAreaGroup(dbClient, filePath, name, { config: CONFIG }),
			(error: Error) =>
				error instanceof GroupLoadError &&
				/a feature with no category, which config\/reference-data.yaml doesn't put in a group/.test(error.message)
		);
	});

	test("uses the app's own groups by default", async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');
		await assert.rejects(
			() => importConsulteeAreaGroup(dbClient, path.join(dir, 'missing.geojson'), '20261020_nothing.geojson'),
			GroupLoadError
		);
		assert.ok((await groupRowCounts(dbClient)).has('public_bodies'));
		assert.equal(REFERENCE_DATA_CONFIG.groups.length, 5);
	});
});

describe('clearing consultee areas', () => {
	test('deletes a batch at a time until a batch comes back short', async () => {
		// a stubbed client, so no quarter table has to really fill a batch to prove the loop
		const batches = [CLEAR_BATCH_SIZE, 0];
		const $executeRaw = mock.fn(async () => batches.shift() ?? 0);
		const client = { $executeRaw } as unknown as PrismaClient;
		assert.equal(await clearConsulteeAreas(client, '2026Q4'), CLEAR_BATCH_SIZE);
		assert.equal($executeRaw.mock.callCount(), 2);
		const table = $executeRaw.mock.calls[0].arguments[2] as { text: string };
		assert.equal(table.text, 'consultee_area_2026Q4');
	});

	test('with no quarter given, clears the dataset in use through the synonym', async () => {
		const statements: string[] = [];
		const $executeRaw = mock.fn(async (sql: TemplateStringsArray) => {
			statements.push(sql.join('?'));
			return 0;
		});
		const client = { $executeRaw } as unknown as PrismaClient;
		assert.equal(await clearConsulteeAreas(client), 0);
		assert.match(statements[0], /FROM consultee_area$/);
	});

	test('empties the dataset in use (runs in CI only - it would empty the shared local table)', async (t) => {
		if (!process.env.CI && !process.env.TF_BUILD) return t.skip('empties every consultee area - runs in CI only');
		if (!dbAvailable) return t.skip('SQL Server database not available');
		await load(inUseFile('groups_test'), ['groups-a']);
		assert.ok((await clearConsulteeAreas(dbClient)) >= 1);
		assert.equal((await groupRowCounts(dbClient, CONFIG)).get('groups_test'), 0);
	});
});
