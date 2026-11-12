import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { PrismaClient } from '../client/client.ts';
import { loadConfig } from '../configuration/config.ts';
import { acquireDbTestLock, releaseDbTestLock } from '../db-test-lock.ts';
import { newDatabaseClient } from '../index.ts';
import type { ConsulteeAreaFeatureCollection } from './consultee-areas.ts';
import {
	bufferGeometryForDisplay,
	consulteeAreaDetails,
	consulteeAreaTable,
	datasetInUse,
	findConsulteeAreasByName,
	findConsulteeAreasByNameStart,
	getConsulteeAreaById,
	getConsulteeAreaDisplayGeometries,
	listConsulteeAreas,
	loadConsulteeAreas,
	sharedConsulteeNames,
	tableSql
} from './consultee-areas.ts';

// fixed ids, rather than a wholesale table truncate, so this suite can't wipe out other data in
// a shared local dev database
const testAreaId = '11111111-1111-1111-1111-111111111111';
const secondAreaId = '11111111-1111-1111-1111-111111111112';
const thirdAreaId = '11111111-1111-1111-1111-111111111113';

let dbClient: PrismaClient;
let dbAvailable = false;

before(async () => {
	try {
		const config = loadConfig();
		dbClient = newDatabaseClient(config.db);
		await dbClient.$queryRaw`SELECT 1 AS probe`;
		dbAvailable = true;
		// the import suites replace the whole consultee_area table, so the files that write
		// the real database take turns rather than run at the same time
		await acquireDbTestLock();
	} catch {
		dbAvailable = false;
	}
});

after(async () => {
	releaseDbTestLock();
	await dbClient?.$disconnect();
});

async function cleanup() {
	await dbClient.$executeRaw`DELETE FROM consultee_area WHERE id IN (${testAreaId}, ${secondAreaId}, ${thirdAreaId})`;
}

describe('consultee areas (requires a local SQL Server - see docker-compose.yml)', () => {
	test('load, get and findIntersecting round-trip a stored area', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		await cleanup();
		try {
			const featureCollection: ConsulteeAreaFeatureCollection = {
				type: 'FeatureCollection',
				features: [
					{
						id: testAreaId,
						type: 'Feature',
						geometry: {
							type: 'Polygon',
							coordinates: [
								[
									[-0.15, 51.5],
									[-0.1, 51.5],
									[-0.1, 51.52],
									[-0.15, 51.52],
									[-0.15, 51.5]
								]
							]
						},
						properties: {
							consulteeCategory: 'Environment Agency',
							consultee: 'Environment Agency',
							region: 'London',
							metadata: { source: 'test' }
						}
					}
				]
			};

			const loadedCount = await loadConsulteeAreas(dbClient, featureCollection);
			assert.equal(loadedCount, 1);

			// by id, not listConsulteeAreas + a fixed limit - a real (or previously-imported) large
			// dataset in the same database shouldn't be able to push this test row out of range
			const stored = await getConsulteeAreaById(dbClient, testAreaId);
			assert.ok(stored, 'expected the loaded area to come back from getConsulteeAreaById');
			assert.equal(stored.properties.consulteeCategory, 'Environment Agency');
			assert.deepEqual(stored.geometry, featureCollection.features[0].geometry);
			assert.deepEqual(stored.properties.metadata, { source: 'test' });

			// the ruleset's distance and bordering queries (now in apps/function-python) run against
			// the simplified copy the loader stores alongside the original
			const [simplifiedRow] = await dbClient.$queryRaw<{ simplified: number }[]>`
				SELECT CASE WHEN geometrySimplified IS NULL THEN 0 ELSE 1 END AS simplified
				FROM consultee_area WHERE id = ${testAreaId}
			`;
			assert.equal(simplifiedRow.simplified, 1);

			// the whole-table listing finds the test row wherever it lands, while a real
			// (or previously-imported) dataset sharing the database could push it past any
			// fixed page - so the paginated branch is checked on shape, not contents
			const listed = await listConsulteeAreas(dbClient);
			assert.equal(listed.type, 'FeatureCollection');
			assert.ok(
				listed.features.some((feature) => feature.id === testAreaId),
				'expected the loaded area in listConsulteeAreas'
			);
			const page = await listConsulteeAreas(dbClient, { limit: 1, offset: 0 });
			assert.equal(page.type, 'FeatureCollection');
			assert.equal(page.features.length, 1);

			// an area touching the window is drawn whole, not clipped to it
			const window = {
				type: 'Polygon' as const,
				coordinates: [
					[
						[-0.125, 51.49],
						[-0.09, 51.49],
						[-0.09, 51.53],
						[-0.125, 51.53],
						[-0.125, 51.49]
					]
				] as [number, number][][]
			};
			const whole = (await getConsulteeAreaDisplayGeometries(dbClient, [testAreaId], window)).get(testAreaId);
			assert.ok(whole && whole.type === 'Polygon', 'expected a polygon');
			const longitudes = whole.coordinates[0].map(([longitude]) => longitude);
			assert.equal(Math.min(...longitudes), -0.15, 'expected the part west of the window too');
			assert.equal(Math.max(...longitudes), -0.1);

			// a display buffer of a point is a ring roughly the distance away in every direction
			const buffered = await bufferGeometryForDisplay(dbClient, { type: 'Point', coordinates: [-0.1, 51.5] }, 1_000);
			assert.ok(buffered.type === 'Polygon');
			const latitudes = buffered.coordinates[0].map(([, latitude]) => latitude);
			const latitudeSpanMetres = (Math.max(...latitudes) - Math.min(...latitudes)) * 111_320;
			assert.ok(Math.abs(latitudeSpanMetres - 2_000) < 60, `expected ~2km across, got ${latitudeSpanMetres}m`);

			// an area with nothing inside the window is left out
			const farWindow = {
				type: 'Polygon' as const,
				coordinates: [
					[
						[2.3, 48.8],
						[2.4, 48.8],
						[2.4, 48.9],
						[2.3, 48.9],
						[2.3, 48.8]
					]
				] as [number, number][][]
			};
			assert.equal((await getConsulteeAreaDisplayGeometries(dbClient, [testAreaId], farWindow)).size, 0);
			// with no window - a consultee added by hand from anywhere - it's drawn wherever it is
			assert.equal((await getConsulteeAreaDisplayGeometries(dbClient, [testAreaId])).get(testAreaId)?.type, 'Polygon');

			// a well-formed id with no row behind it is a genuine not-found, not an error
			assert.equal(await getConsulteeAreaById(dbClient, '99999999-9999-9999-9999-999999999999'), null);
		} finally {
			await cleanup();
		}
	});

	test('load reports progress per batch and stores every populated column', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		const progress: [number, number][] = [];
		await cleanup();
		try {
			const featureCollection: ConsulteeAreaFeatureCollection = {
				type: 'FeatureCollection',
				features: [
					{
						id: testAreaId,
						type: 'Feature',
						geometry: { type: 'Point', coordinates: [0, 0] },
						properties: {
							sourceId: 'railway_RAIL_EW_00001',
							consulteeCategory: 'Railways',
							consulteeGroup: 'Railways',
							consulteeSubcategory: 'Active',
							consulteeSubcategoryDescription: 'Railway line in use',
							currentVersion: 2,
							validFrom: '2026-10-19',
							validTo: '2027-03-31',
							consultee: 'Network Rail',
							region: 'South',
							metadata: { source: 'test' }
						}
					},
					// and one with everything optional absent, so the loaders exercise both sides of
					// each null/default fallback
					{
						id: secondAreaId,
						type: 'Feature',
						geometry: { type: 'Point', coordinates: [1, 1] },
						properties: {}
					}
				]
			};

			// batchSize 1 forces a second batch, so progress fires once per row
			const loaded = await loadConsulteeAreas(dbClient, featureCollection, {
				batchSize: 1,
				onProgress: (done, total) => progress.push([done, total])
			});
			assert.equal(loaded, 2);
			assert.deepEqual(progress, [
				[1, 2],
				[2, 2]
			]);

			const stored = await getConsulteeAreaById(dbClient, testAreaId);
			assert.ok(stored);
			assert.deepEqual(stored.properties, {
				sourceId: 'railway_RAIL_EW_00001',
				consulteeCategory: 'Railways',
				consulteeGroup: 'Railways',
				consulteeSubcategory: 'Active',
				consulteeSubcategoryDescription: 'Railway line in use',
				consultee: 'Network Rail',
				region: 'South',
				metadata: { source: 'test' }
			});

			// stored, though nothing reads them back - they're not shown in the report
			const [versioned] = await dbClient.$queryRaw<{ currentVersion: number; validFrom: string; validTo: string }[]>`
				SELECT currentVersion, CONVERT(VARCHAR(10), validFrom, 23) AS validFrom,
					CONVERT(VARCHAR(10), validTo, 23) AS validTo
				FROM consultee_area WHERE id = ${testAreaId}
			`;
			assert.deepEqual({ ...versioned }, { currentVersion: 2, validFrom: '2026-10-19', validTo: '2027-03-31' });

			const minimal = await getConsulteeAreaById(dbClient, secondAreaId);
			assert.equal(minimal?.properties.consulteeCategory, null);
			assert.equal(minimal?.properties.sourceId, null);
			assert.equal(minimal?.properties.consulteeGroup, null);
			assert.equal(minimal?.properties.consulteeSubcategory, null);
		} finally {
			await cleanup();
		}
	});

	test('loading the same id twice upserts rather than duplicating', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		await cleanup();
		try {
			const baseFeature = {
				id: testAreaId,
				type: 'Feature' as const,
				geometry: { type: 'Point' as const, coordinates: [0, 0] as [number, number] },
				properties: { consultee: 'Original' }
			};
			await loadConsulteeAreas(dbClient, { type: 'FeatureCollection', features: [baseFeature] });
			await loadConsulteeAreas(dbClient, {
				type: 'FeatureCollection',
				features: [{ ...baseFeature, properties: { consultee: 'Updated' } }]
			});

			// id is the primary key, so a genuine duplicate is structurally impossible - a second
			// loadConsulteeAreas() call would throw a PK violation instead of silently duplicating.
			// This just confirms it went through the UPDATE branch, not NOT MATCHED/INSERT again
			const updated = await getConsulteeAreaById(dbClient, testAreaId);
			assert.equal(updated?.properties.consultee, 'Updated');
		} finally {
			await cleanup();
		}
	});

	test('finds a consultee by name in its category, case aside, nearest the site', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		await cleanup();
		try {
			const square = (west: number) => ({
				type: 'Polygon' as const,
				coordinates: [
					[
						[west, 51.5],
						[west + 0.01, 51.5],
						[west + 0.01, 51.51],
						[west, 51.51],
						[west, 51.5]
					]
				]
			});
			// two areas share the test name - one near the site, one far from it
			const testName = 'Findconsulteebyname Test Parish';
			await loadConsulteeAreas(dbClient, {
				type: 'FeatureCollection',
				features: [
					{
						id: testAreaId,
						type: 'Feature',
						geometry: square(-2),
						properties: { consulteeCategory: 'Parish, town and community councils', consultee: testName, region: 'Far' }
					},
					{
						id: secondAreaId,
						type: 'Feature',
						geometry: square(-0.15),
						properties: {
							consulteeCategory: 'Parish, town and community councils',
							consultee: testName,
							region: 'Near'
						}
					},
					// a name starting the same way, nearer the site than the far one
					{
						id: thirdAreaId,
						type: 'Feature',
						geometry: square(-0.5),
						properties: {
							consulteeCategory: 'Parish, town and community councils',
							consultee: `${testName} North`,
							region: 'Near'
						}
					}
				]
			});
			const site = { type: 'Point' as const, coordinates: [-0.14, 51.505] };

			// both, nearest first, with their regions to tell them apart - case aside
			const found = await findConsulteeAreasByName(
				dbClient,
				'Parish, town and community councils',
				testName.toUpperCase(),
				site
			);
			assert.deepEqual(
				found.map(({ id, consultee, region }) => ({ id, consultee, region })),
				[
					{ id: secondAreaId, consultee: testName, region: 'Near' },
					{ id: testAreaId, consultee: testName, region: 'Far' }
				]
			);
			assert.equal(found[0].distanceMetres, 0);
			assert.ok(found[1].distanceMetres > 100_000);

			// another category, or a name that isn't a consultee - none
			assert.deepEqual(
				await findConsulteeAreasByName(
					dbClient,
					'Hospitals operated by NHS trusts and NHS foundation trusts (England)',
					testName,
					site
				),
				[]
			);
			assert.deepEqual(
				await findConsulteeAreasByName(dbClient, 'Parish, town and community councils', 'Banana', site),
				[]
			);

			// as a name is typed: those called exactly that first, nearest first, then the ones it starts
			assert.deepEqual(
				(
					await findConsulteeAreasByNameStart(
						dbClient,
						'Parish, town and community councils',
						testName.toLowerCase(),
						site
					)
				).map(({ id }) => id),
				[secondAreaId, testAreaId, thirdAreaId]
			);
			assert.deepEqual(
				(await findConsulteeAreasByNameStart(dbClient, 'Parish, town and community councils', 'Findconsulteeby', site))
					.map(({ id }) => id)
					.sort(),
				[testAreaId, secondAreaId, thirdAreaId].sort()
			);
			// what's typed is matched as it is - a % or _ isn't a wildcard
			for (const typed of ['%', 'Findconsulteeby_ame', 'Findconsulteebyname Test Parish [']) {
				assert.deepEqual(
					await findConsulteeAreasByNameStart(dbClient, 'Parish, town and community councils', typed, site),
					[],
					typed
				);
			}

			// the name both share - twice in the reference data - and not the one only one has
			assert.deepEqual(
				await sharedConsulteeNames(dbClient, 'Parish, town and community councils', [
					testName.toUpperCase(),
					`${testName} North`,
					testName
				]),
				new Set([testName.toLowerCase()])
			);
			assert.deepEqual(await sharedConsulteeNames(dbClient, 'Parish, town and community councils', []), new Set());
		} finally {
			await cleanup();
		}
	});

	test('keeps a representative point on each area, which suggestions are ranked by - their distances are exact', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		await cleanup();
		try {
			// out in the Atlantic: a U whose envelope centre falls in its notch, off the area
			const u = {
				type: 'Polygon' as const,
				coordinates: [
					[
						[-30, 50],
						[-29.9, 50],
						[-29.9, 50.1],
						[-29.93, 50.1],
						[-29.93, 50.03],
						[-29.97, 50.03],
						[-29.97, 50.1],
						[-30, 50.1],
						[-30, 50]
					]
				]
			};
			const square = {
				...u,
				coordinates: [
					[
						[-31, 50],
						[-30.99, 50],
						[-30.99, 50.01],
						[-31, 50.01],
						[-31, 50]
					]
				]
			};
			const category = 'Parish, town and community councils';
			await loadConsulteeAreas(dbClient, {
				type: 'FeatureCollection',
				features: [
					{
						id: testAreaId,
						type: 'Feature',
						geometry: u,
						properties: { consulteeCategory: category, consultee: 'Pointtest Bay' }
					},
					{
						id: secondAreaId,
						type: 'Feature',
						geometry: square,
						properties: { consulteeCategory: category, consultee: 'Pointtest Square' }
					}
				]
			});

			const [onArea] = await dbClient.$queryRaw<{ pointOnArea: boolean; centreOnArea: boolean }[]>`
				SELECT CAST(representativePoint.STIntersects(geometrySimplified) AS BIT) AS pointOnArea,
					CAST(geometrySimplified.STIntersects(geometrySimplified.EnvelopeCenter()) AS BIT) AS centreOnArea
				FROM consultee_area WHERE id = ${testAreaId}`;
			assert.deepEqual(onArea, { pointOnArea: true, centreOnArea: false });

			// an area without one is still suggested, ranked by its envelope centre
			await dbClient.$executeRaw`UPDATE consultee_area SET representativePoint = NULL WHERE id = ${secondAreaId}`;

			// a site in the U's notch: 0.02° of longitude from either arm
			const site = { type: 'Point' as const, coordinates: [-29.95, 50.06] };
			const found = await findConsulteeAreasByNameStart(dbClient, category, 'pointtest', site);
			assert.deepEqual(
				found.map(({ id }) => id),
				[testAreaId, secondAreaId]
			);
			const exact = await dbClient.$queryRaw<{ id: string; metres: number }[]>`
				SELECT LOWER(CAST(id AS NVARCHAR(36))) AS id,
					geometrySimplified.STDistance(geography::Point(50.06, -29.95, 4326)) AS metres
				FROM consultee_area WHERE id IN (${testAreaId}, ${secondAreaId})`;
			for (const area of found) {
				const metres = exact.find(({ id }) => id === area.id)!.metres;
				assert.ok(Math.abs(area.distanceMetres - metres) < 1, `${area.id}: ${area.distanceMetres} vs ${metres}`);
			}
			assert.ok(found[0].distanceMetres > 1_000 && found[0].distanceMetres < 2_000);
		} finally {
			await cleanup();
		}
	});

	test("gives each consultee's details, and a parish the council area it's in", async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		await cleanup();
		try {
			// out in the Atlantic, clear of the real data a local database holds
			const square = (west: number, south: number, size: number) => ({
				type: 'Polygon' as const,
				coordinates: [
					[
						[west, south],
						[west + size, south],
						[west + size, south + size],
						[west, south + size],
						[west, south]
					]
				]
			});
			await loadConsulteeAreas(dbClient, {
				type: 'FeatureCollection',
				features: [
					{
						id: testAreaId,
						type: 'Feature',
						geometry: square(-30, 50, 0.01),
						properties: {
							consulteeCategory: 'Parish, town and community councils',
							consultee: 'Detail Test Parish',
							region: 'Test Region',
							consulteeSubcategory: 'Parish Councils'
						}
					},
					{
						id: secondAreaId,
						type: 'Feature',
						geometry: square(-30.05, 49.95, 0.2),
						properties: {
							consulteeCategory: 'District councils (lower-tier authorities)',
							consultee: 'Detail Test District'
						}
					},
					{
						id: thirdAreaId,
						type: 'Feature',
						geometry: square(-35, 50, 0.01),
						properties: {
							consulteeCategory: 'Parish, town and community councils',
							consultee: 'Detail Test Parish',
							region: 'Elsewhere'
						}
					}
				]
			});

			const details = await consulteeAreaDetails(dbClient, [
				testAreaId.toUpperCase(),
				thirdAreaId,
				'99999999-0000-0000-0000-000000000000',
				'added-0'
			]);
			assert.deepEqual(details.get(testAreaId), {
				region: 'Test Region',
				subcategory: 'Parish Councils',
				metadata: '{}',
				authority: 'Detail Test District'
			});
			// one with no row, and one that isn't an id, are absent - a parish in no council area the data has
			// has none, and a district no council area of its own
			assert.equal(details.get(thirdAreaId)?.authority, null);
			assert.equal(details.get(thirdAreaId)?.region, 'Elsewhere');
			assert.equal((await consulteeAreaDetails(dbClient, [secondAreaId])).get(secondAreaId)?.authority, null);
			assert.equal(details.size, 2);
		} finally {
			await cleanup();
		}
	});
});

// the quarter/table guards and the synonym check need no database - they run whether or not a
// local SQL Server is up
describe('dataset table names', () => {
	test('consulteeAreaTable maps a quarter onto its table', () => {
		assert.equal(consulteeAreaTable('2026Q4'), 'consultee_area_2026Q4');
	});

	test('consulteeAreaTable refuses anything that is not a quarter', () => {
		for (const quarter of ['latest', '2026', '2026Q0', '2026Q5', '2026q4', 'consultee_area_2026Q4']) {
			assert.throws(() => consulteeAreaTable(quarter), new RegExp(`"${quarter}" isn't a quarter`), quarter);
		}
	});

	test('tableSql passes the synonym and a quarter table through as raw SQL', () => {
		assert.equal(tableSql('consultee_area').text, 'consultee_area');
		assert.equal(tableSql('consultee_area_2026Q4').text, 'consultee_area_2026Q4');
	});

	test('tableSql refuses any other table name', () => {
		for (const table of ['case_boundary', 'consultee_areas', 'consultee_area_2026', 'consultee_area_2026Q5']) {
			assert.throws(() => tableSql(table), new RegExp(`${table} isn't a consultee area table`), table);
		}
	});
});

describe('datasetInUse', () => {
	test('reads the quarter the consultee_area synonym points at', async () => {
		const client = {
			$queryRaw: async () => [{ baseObjectName: '[dbo].[consultee_area_2026Q4]' }]
		} as unknown as PrismaClient;
		assert.equal(await datasetInUse(client), '2026Q4');
	});

	test('throws when no consultee_area synonym exists', async () => {
		const client = { $queryRaw: async () => [] } as unknown as PrismaClient;
		await assert.rejects(() => datasetInUse(client), /doesn't point at a quarter's table/);
	});

	test('throws when the synonym points at something that is not a quarter table', async () => {
		const client = {
			$queryRaw: async () => [{ baseObjectName: '[dbo].[consultee_area_archive]' }]
		} as unknown as PrismaClient;
		await assert.rejects(() => datasetInUse(client), /doesn't point at a quarter's table/);
	});
});
