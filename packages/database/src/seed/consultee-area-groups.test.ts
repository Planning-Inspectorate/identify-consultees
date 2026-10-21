import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { PrismaClient } from '../client/client.ts';
import { loadConfig } from '../configuration/config.ts';
import { acquireDbTestLock, releaseDbTestLock } from '../db-test-lock.ts';
import { newDatabaseClient } from '../index.ts';
import {
	clearConsulteeAreas,
	dateFromFileName,
	groupBlobName,
	GroupLoadError,
	groupRowCounts,
	importConsulteeAreaGroup,
	isoDate,
	latestGroupLoads,
	parseGroupBlobName,
	quarterOf
} from './consultee-area-groups.ts';
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
		assert.equal(quarterOf('2026-01-01'), '2026-Q1');
		assert.equal(quarterOf('2026-03-31'), '2026-Q1');
		assert.equal(quarterOf('2026-04-01'), '2026-Q2');
		assert.equal(quarterOf('2026-09-30'), '2026-Q3');
		assert.equal(quarterOf('2026-10-20'), '2026-Q4');
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
const CATEGORIES = ['Groups Test Area', 'Groups Other Area'];
const SLUGS = ['groups_test', 'groups_other'];

let dbClient: PrismaClient;
let dbAvailable = false;
let dir: string;

before(async () => {
	dir = await mkdtemp(path.join(tmpdir(), 'consultee-area-groups-'));
	try {
		dbClient = newDatabaseClient(loadConfig().db);
		await dbClient.$queryRaw`SELECT 1 AS probe`;
		dbAvailable = true;
		await acquireDbTestLock();
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

async function cleanup() {
	await dbClient.$executeRaw`DELETE FROM consultee_area WHERE consulteeCategory IN (${CATEGORIES[0]}, ${CATEGORIES[1]})`;
	await dbClient.$executeRaw`DELETE FROM consultee_area_archive WHERE consulteeCategory IN (${CATEGORIES[0]}, ${CATEGORIES[1]})`;
	await dbClient.$executeRaw`DELETE FROM reference_data_load WHERE dataGroup IN (${SLUGS[0]}, ${SLUGS[1]})`;
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

async function rowsOf(table: 'consultee_area' | 'consultee_area_archive') {
	return dbClient.$queryRawUnsafe<{ sourceId: string; quarter?: string }[]>(
		`SELECT sourceId${table === 'consultee_area_archive' ? ', quarter' : ''} FROM ${table}
		WHERE consulteeCategory = 'Groups Test Area' ORDER BY sourceId`
	);
}

describe('loading a group (requires a local SQL Server - see docker-compose.yml)', () => {
	test("replaces the group's rows within a quarter, and archives them for a later one", async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');
		await cleanup();

		const first = await load('20260801_groups_test.geojson', ['groups-a', 'groups-b']);
		assert.deepEqual(
			{ ...first, group: first.group.slug },
			{ group: 'groups_test', quarter: '2026-Q3', rowsLoaded: 2, rowsArchived: 0 }
		);

		// the same quarter's data replaces it - nothing archived
		await load('20260915_groups_test.geojson', ['groups-c']);
		assert.deepEqual(await rowsOf('consultee_area'), [{ sourceId: 'groups-c' }]);
		assert.deepEqual(await rowsOf('consultee_area_archive'), []);

		// a later quarter's moves it to the archive, labelled with its quarter
		const next = await load('20261020_groups_test.geojson', ['groups-d', 'groups-e']);
		assert.equal(next.rowsArchived, 1);
		assert.equal(next.archivedQuarter, '2026-Q3');
		assert.deepEqual(await rowsOf('consultee_area'), [{ sourceId: 'groups-d' }, { sourceId: 'groups-e' }]);
		assert.deepEqual(await rowsOf('consultee_area_archive'), [{ sourceId: 'groups-c', quarter: '2026-Q3' }]);

		const loads = await latestGroupLoads(dbClient);
		const latest = loads.get('groups_test');
		assert.equal(latest?.blobName, '20261020_groups_test.geojson');
		assert.equal(latest?.quarter, '2026-Q4');
		assert.equal(latest?.rowsLoaded, 2);
		assert.equal(latest?.rowsArchived, 1);
		assert.deepEqual(latest?.dataDate, new Date('2026-10-20T00:00:00Z'));
		assert.equal(loads.has('groups_other'), false);
		assert.deepEqual(
			[...(await groupRowCounts(dbClient, CONFIG))],
			[
				['groups_test', 2],
				['groups_other', 0]
			]
		);
	});

	test("refuses an earlier quarter, another group's category, an empty file or a name that isn't a group's - changing nothing", async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');
		await cleanup();
		await load('20261020_groups_test.geojson', ['groups-a']);

		for (const [name, ids, category, message] of [
			[
				'20260601_groups_test.geojson',
				['groups-x'],
				undefined,
				/holds 2026-Q4 data, and 20260601_groups_test\.geojson is from 2026-Q2/
			],
			[
				'20261021_groups_test.geojson',
				['groups-x'],
				'Groups Other Area',
				/groups-x, a Groups Other Area, which belongs in Groups Other - not Groups Test/
			],
			[
				'20261021_groups_test.geojson',
				['groups-x'],
				'Unheard Of',
				/a Unheard Of, which config\/reference-data.yaml doesn't put in a group/
			],
			['20261021_groups_test.geojson', [], undefined, /holds no consultee areas/],
			['groups_test.geojson', ['groups-x'], undefined, /isn't a group's file/]
		] as const) {
			await assert.rejects(
				() => load(name, [...ids], category),
				(error: Error) => error instanceof GroupLoadError && message.test(error.message),
				name
			);
		}
		assert.deepEqual(await rowsOf('consultee_area'), [{ sourceId: 'groups-a' }]);
		assert.equal((await latestGroupLoads(dbClient)).get('groups_test')?.blobName, '20261020_groups_test.geojson');
	});

	test('loads an earlier quarter into an empty group, and replaces rows loaded before groups were logged', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');
		await cleanup();
		await load('20261020_groups_test.geojson', ['groups-a']);
		// emptied - say by Clear - so there's nothing an earlier quarter would overwrite
		await dbClient.$executeRaw`DELETE FROM consultee_area WHERE consulteeCategory = 'Groups Test Area'`;
		await load('20260601_groups_test.geojson', ['groups-b']);
		assert.deepEqual(await rowsOf('consultee_area'), [{ sourceId: 'groups-b' }]);

		// rows with no load logged - from a full import - are replaced, as their quarter isn't known
		await dbClient.$executeRaw`DELETE FROM reference_data_load WHERE dataGroup = 'groups_test'`;
		await load('20261020_groups_test.geojson', ['groups-c']);
		assert.deepEqual(await rowsOf('consultee_area'), [{ sourceId: 'groups-c' }]);
		assert.deepEqual(await rowsOf('consultee_area_archive'), []);
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
	test('empties consultee_area (runs in CI only - it would empty the shared local table)', async (t) => {
		if (!process.env.CI && !process.env.TF_BUILD) return t.skip('empties every consultee area - runs in CI only');
		if (!dbAvailable) return t.skip('SQL Server database not available');
		await load('20261020_groups_test.geojson', ['groups-a']);
		assert.ok((await clearConsulteeAreas(dbClient)) >= 1);
		assert.equal((await groupRowCounts(dbClient, CONFIG)).get('groups_test'), 0);
	});
});
