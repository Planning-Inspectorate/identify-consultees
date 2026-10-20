import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { PrismaClient } from '../client/client.ts';
import { Prisma } from '../client/client.ts';
import { loadConfig } from '../configuration/config.ts';
import { acquireDbTestLock, releaseDbTestLock } from '../db-test-lock.ts';
import { newDatabaseClient } from '../index.ts';
import type { CaseBoundaryFeatureCollection } from './case-boundaries.ts';
import {
	findNearbyCases,
	getCaseBoundaryById,
	getCaseBoundaryDisplayGeometries,
	getCaseBoundarySummaryById,
	listCaseBoundaries,
	listCaseBoundaryFiles,
	loadCaseBoundaries,
	searchCaseBoundaries
} from './case-boundaries.ts';

// a fixed id, rather than a wholesale table truncate, so this suite can't wipe out other data in
// a shared local dev database
const testBoundaryId = '22222222-2222-2222-2222-222222222222';

let dbClient: PrismaClient;
let dbAvailable = false;

before(async () => {
	try {
		const config = loadConfig();
		dbClient = newDatabaseClient(config.db);
		await dbClient.$queryRaw`SELECT 1 AS probe`;
		dbAvailable = true;
		// the import suites replace the whole case_boundary table, so the files that write
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
	await dbClient.$executeRaw`DELETE FROM case_boundary WHERE id = ${testBoundaryId}`;
}

describe('case boundaries (requires a local SQL Server - see docker-compose.yml)', () => {
	test('load, list, findNear and findIntersecting round-trip a stored boundary', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		await cleanup();
		try {
			const featureCollection: CaseBoundaryFeatureCollection = {
				type: 'FeatureCollection',
				features: [
					{
						id: testBoundaryId,
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
							caseReference: 'EN010001',
							caseName: 'Test case',
							metadata: { source: 'test' }
						}
					}
				]
			};

			const loadedCount = await loadCaseBoundaries(dbClient, featureCollection);
			assert.equal(loadedCount, 1);

			const listed = await listCaseBoundaries(dbClient, { limit: 100 });
			const stored = listed.features.find((feature) => feature.id === testBoundaryId);
			assert.ok(stored, 'expected the loaded boundary to come back from listCaseBoundaries');
			assert.equal(stored.properties.caseReference, 'EN010001');
			assert.deepEqual(stored.geometry, featureCollection.features[0].geometry);
			assert.deepEqual(stored.properties.metadata, { source: 'test' });
		} finally {
			await cleanup();
		}
	});

	test('loading the same id twice upserts rather than duplicating', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		await cleanup();
		try {
			const baseFeature = {
				id: testBoundaryId,
				type: 'Feature' as const,
				geometry: { type: 'Point' as const, coordinates: [0, 0] as [number, number] },
				properties: { caseReference: 'EN010001', caseName: 'Original name' }
			};
			await loadCaseBoundaries(dbClient, { type: 'FeatureCollection', features: [baseFeature] });
			await loadCaseBoundaries(dbClient, {
				type: 'FeatureCollection',
				features: [{ ...baseFeature, properties: { ...baseFeature.properties, caseName: 'Updated name' } }]
			});

			const listed = await listCaseBoundaries(dbClient);
			const matches = listed.features.filter((feature) => feature.id === testBoundaryId);
			assert.equal(matches.length, 1);
			assert.equal(matches[0].properties.caseName, 'Updated name');
		} finally {
			await cleanup();
		}
	});

	test('getCaseBoundaryById finds a stored boundary and returns null otherwise', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		await cleanup();
		try {
			await loadCaseBoundaries(dbClient, {
				type: 'FeatureCollection',
				features: [
					{
						id: testBoundaryId,
						type: 'Feature',
						geometry: { type: 'Point', coordinates: [0, 0] },
						properties: { caseReference: 'EN010001', caseName: 'Findable by id' }
					}
				]
			});

			const found = await getCaseBoundaryById(dbClient, testBoundaryId);
			assert.equal(found?.properties.caseName, 'Findable by id');

			const missing = await getCaseBoundaryById(dbClient, '99999999-9999-9999-9999-999999999999');
			assert.equal(missing, null);
		} finally {
			await cleanup();
		}
	});

	test('getCaseBoundarySummaryById finds a stored boundary without its geometry, and returns null otherwise', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		await cleanup();
		try {
			await loadCaseBoundaries(dbClient, {
				type: 'FeatureCollection',
				features: [
					{
						id: testBoundaryId,
						type: 'Feature',
						geometry: { type: 'Point', coordinates: [0, 0] },
						properties: {
							caseReference: 'EN010001',
							caseName: 'Findable by id',
							receivedDate: new Date(Date.UTC(2026, 2, 3))
						}
					}
				]
			});

			const found = await getCaseBoundarySummaryById(dbClient, testBoundaryId);
			assert.deepEqual(found, {
				id: testBoundaryId,
				reference: 'EN010001',
				caseName: 'Findable by id',
				receivedDate: new Date(Date.UTC(2026, 2, 3)),
				acceptance: null
			});
			assert.ok(!('geometry' in (found as object)), 'summary should not carry geometry');

			const missing = await getCaseBoundarySummaryById(dbClient, '99999999-9999-9999-9999-999999999999');
			assert.equal(missing, null);
		} finally {
			await cleanup();
		}
	});

	test('searchCaseBoundaries matches by name or reference and reports a total count', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		await cleanup();
		try {
			await loadCaseBoundaries(dbClient, {
				type: 'FeatureCollection',
				features: [
					{
						id: testBoundaryId,
						type: 'Feature',
						geometry: { type: 'Point', coordinates: [0, 0] },
						properties: { caseReference: 'ZZ999999', caseName: 'Searchable Wind Farm' }
					}
				]
			});

			const byName = await searchCaseBoundaries(dbClient, { query: 'Searchable Wind' });
			assert.ok(byName.features.some((feature) => feature.id === testBoundaryId));
			assert.ok(byName.total >= 1);

			const byReference = await searchCaseBoundaries(dbClient, { query: 'ZZ999999' });
			assert.ok(byReference.features.some((feature) => feature.id === testBoundaryId));

			const noMatch = await searchCaseBoundaries(dbClient, { query: 'no-such-project-exists-anywhere' });
			assert.equal(noMatch.features.length, 0);
			assert.equal(noMatch.total, 0);
		} finally {
			await cleanup();
		}
	});

	test('searchCaseBoundaries returns one result per case - its newest submission', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		const olderId = '22222222-2222-2222-2222-222222222224';
		const undatedId = '22222222-2222-2222-2222-222222222225';
		const cleanupFiles = async () => {
			await dbClient.$executeRaw`DELETE FROM case_boundary WHERE id IN (${testBoundaryId}, ${olderId}, ${undatedId})`;
		};
		const submission = (id: string, caseName: string, receivedDate: Date | null, fileName: string) => ({
			id,
			type: 'Feature' as const,
			geometry: { type: 'Point' as const, coordinates: [0, 0] as [number, number] },
			properties: { caseReference: 'ZZ999998', caseName, fileName, receivedDate }
		});

		await cleanupFiles();
		try {
			await loadCaseBoundaries(dbClient, {
				type: 'FeatureCollection',
				features: [
					submission(olderId, 'Oldname Solar Farm', new Date('2025-01-01T00:00:00Z'), 'old.geojson'),
					submission(testBoundaryId, 'Twice Submitted Solar Farm', new Date('2026-01-01T00:00:00Z'), 'new.geojson'),
					submission(undatedId, 'Twice Submitted Solar Farm', null, 'undated.geojson')
				]
			});

			const byReference = await searchCaseBoundaries(dbClient, { query: 'ZZ999998' });
			assert.deepEqual(
				byReference.features.map((feature) => feature.id),
				[testBoundaryId]
			);
			assert.equal(byReference.total, 1);

			// a match on an older submission's name still finds the case, as its newest submission
			const byOldName = await searchCaseBoundaries(dbClient, { query: 'Oldname Solar' });
			assert.deepEqual(
				byOldName.features.map((feature) => [feature.id, feature.caseName]),
				[[testBoundaryId, 'Twice Submitted Solar Farm']]
			);

			// an out-of-range page counts cases, not submissions
			const outOfRange = await searchCaseBoundaries(dbClient, { query: 'ZZ999998', offset: 1000 });
			assert.equal(outOfRange.total, 1);
		} finally {
			await cleanupFiles();
		}
	});

	test('listCaseBoundaryFiles returns every file for a caseReference, newest first', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		const olderFileId = '22222222-2222-2222-2222-222222222223';
		const cleanupFiles = async () => {
			await dbClient.$executeRaw`DELETE FROM case_boundary WHERE id IN (${testBoundaryId}, ${olderFileId})`;
		};

		await cleanupFiles();
		try {
			await loadCaseBoundaries(dbClient, {
				type: 'FeatureCollection',
				features: [
					{
						id: testBoundaryId,
						type: 'Feature',
						geometry: { type: 'Point', coordinates: [0, 0] },
						properties: {
							caseReference: 'ZZ888888',
							caseName: 'Multi-file case',
							fileName: 'newer.geojson',
							receivedDate: new Date(Date.UTC(2026, 8, 19, 11, 20))
						}
					},
					{
						id: olderFileId,
						type: 'Feature',
						geometry: { type: 'Point', coordinates: [0, 0] },
						properties: {
							caseReference: 'ZZ888888',
							caseName: 'Multi-file case',
							fileName: 'older.geojson',
							receivedDate: new Date(Date.UTC(2026, 6, 29, 12, 16))
						}
					}
				]
			});

			const files = await listCaseBoundaryFiles(dbClient, 'ZZ888888');
			assert.deepEqual(
				files.map((file) => file.id),
				[testBoundaryId, olderFileId]
			);
			assert.equal(files[0].fileName, 'newer.geojson');
			assert.deepEqual(files[1].receivedDate, new Date(Date.UTC(2026, 6, 29, 12, 16)));

			const none = await listCaseBoundaryFiles(dbClient, 'NO-SUCH-REFERENCE');
			assert.deepEqual(none, []);
		} finally {
			await cleanupFiles();
		}
	});

	test('load reports progress per batch and stores optional columns when present', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		const secondBoundaryId = '22222222-2222-2222-2222-222222222226';
		const progress: [number, number][] = [];
		const cleanupBoth = async () => {
			await dbClient.$executeRaw`DELETE FROM case_boundary WHERE id IN (${testBoundaryId}, ${secondBoundaryId})`;
		};

		await cleanupBoth();
		try {
			// batchSize 1 forces a second batch, so progress fires once per row - and one feature
			// carries every optional column while the other omits them, covering both sides of each
			// fallback in the loader
			const loaded = await loadCaseBoundaries(
				dbClient,
				{
					type: 'FeatureCollection',
					features: [
						{
							id: testBoundaryId,
							type: 'Feature',
							geometry: { type: 'Point', coordinates: [0, 0] },
							properties: {
								caseReference: 'EN010001',
								caseName: 'Fully populated',
								fileName: 'v1.geojson',
								receivedDate: new Date(Date.UTC(2026, 0, 5)),
								acceptance: 'Accepted'
							}
						},
						{
							id: secondBoundaryId,
							type: 'Feature',
							geometry: { type: 'Point', coordinates: [1, 1] },
							properties: { caseReference: 'EN010002', caseName: 'Bare minimum' }
						}
					]
				},
				{ batchSize: 1, onProgress: (done, total) => progress.push([done, total]) }
			);
			assert.equal(loaded, 2);
			assert.deepEqual(progress, [
				[1, 2],
				[2, 2]
			]);

			const stored = await getCaseBoundaryById(dbClient, testBoundaryId);
			assert.equal(stored?.properties.acceptance, 'Accepted');
			assert.equal(stored?.properties.fileName, 'v1.geojson');

			const minimal = await getCaseBoundaryById(dbClient, secondBoundaryId);
			assert.equal(minimal?.properties.acceptance, null);
			assert.equal(minimal?.properties.fileName, null);
		} finally {
			await cleanupBoth();
		}
	});

	test('listCaseBoundaries paginates with limit and offset together', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		const page = await listCaseBoundaries(dbClient, { limit: 5, offset: 1 });
		assert.equal(page.type, 'FeatureCollection');
		assert.ok(page.features.length <= 5);
	});

	test('searchCaseBoundaries treats a missing or blank query as match-everything', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		const all = await searchCaseBoundaries(dbClient);
		assert.ok(Array.isArray(all.features));
		assert.ok(all.total >= 0);

		const blank = await searchCaseBoundaries(dbClient, { query: '   ' });
		assert.equal(blank.total, all.total);
	});

	test('searchCaseBoundaries still reports the match total when the page is out of range', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		await cleanup();
		try {
			await loadCaseBoundaries(dbClient, {
				type: 'FeatureCollection',
				features: [
					{
						id: testBoundaryId,
						type: 'Feature',
						geometry: { type: 'Point', coordinates: [0, 0] },
						properties: { caseReference: 'PG999999', caseName: 'Pagination target' }
					}
				]
			});

			const outOfRange = await searchCaseBoundaries(dbClient, { query: 'PG999999', limit: 25, offset: 1000 });
			assert.equal(outOfRange.features.length, 0);
			assert.ok(outOfRange.total >= 1, 'expected the real match count even with no rows on the page');
		} finally {
			await cleanup();
		}
	});
	test('findNearbyCases lists other cases near a site, each once as its newest shapefile', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		// mid-Atlantic, well away from any real case
		const ids = {
			site: testBoundaryId,
			siteOlder: '22222222-2222-2222-2222-222222222230',
			near: '22222222-2222-2222-2222-222222222231',
			nearOlder: '22222222-2222-2222-2222-222222222232',
			touching: '22222222-2222-2222-2222-222222222233',
			far: '22222222-2222-2222-2222-222222222234'
		};
		const cleanupCases = async () => {
			await dbClient.$executeRaw`DELETE FROM case_boundary WHERE id IN (${Prisma.join(Object.values(ids))})`;
		};
		const square = (west: number, south: number) => ({
			type: 'Polygon' as const,
			coordinates: [
				[
					[west, south],
					[west + 0.01, south],
					[west + 0.01, south + 0.01],
					[west, south + 0.01],
					[west, south]
				]
			]
		});
		const submission = (
			id: string,
			caseReference: string,
			geometry: ReturnType<typeof square>,
			receivedDate: Date,
			fileName: string
		) => ({
			id,
			type: 'Feature' as const,
			geometry,
			properties: { caseReference, caseName: `${caseReference} project`, fileName, receivedDate }
		});

		await cleanupCases();
		try {
			await loadCaseBoundaries(dbClient, {
				type: 'FeatureCollection',
				features: [
					submission(ids.site, 'NN000001', square(-35, 45), new Date('2026-01-01T00:00:00Z'), 'site.geojson'),
					// the site's own older shapefile overlaps it - still not a nearby case
					submission(ids.siteOlder, 'NN000001', square(-35, 45), new Date('2025-01-01T00:00:00Z'), 'old.geojson'),
					// about 2km east: newest shapefile wins, whichever is nearer
					submission(ids.near, 'NN000002', square(-34.962, 45), new Date('2026-02-01T00:00:00Z'), 'new.geojson'),
					submission(ids.nearOlder, 'NN000002', square(-34.99, 45), new Date('2025-02-01T00:00:00Z'), 'old.geojson'),
					submission(ids.touching, 'NN000003', square(-34.99, 45.005), new Date('2026-03-01T00:00:00Z'), 'a.geojson'),
					// about 40km away
					submission(ids.far, 'NN000004', square(-34.5, 45), new Date('2026-04-01T00:00:00Z'), 'far.geojson')
				]
			});

			const nearby = await findNearbyCases(dbClient, ids.site, 10_000);
			assert.deepEqual(
				nearby.map((nearbyCase) => [nearbyCase.id, nearbyCase.caseReference, nearbyCase.fileName]),
				[
					[ids.touching, 'NN000003', 'a.geojson'],
					[ids.near, 'NN000002', 'new.geojson']
				]
			);
			assert.equal(nearby[0].distanceMetres, 0);
			assert.ok(nearby[1].distanceMetres > 1000 && nearby[1].distanceMetres < 3000, `${nearby[1].distanceMetres}`);
			assert.equal(nearby[1].caseName, 'NN000002 project');
			assert.deepEqual(nearby[1].receivedDate, new Date('2026-02-01T00:00:00Z'));

			// from the site's older shapefile, the same case is still left out
			assert.deepEqual(
				(await findNearbyCases(dbClient, ids.siteOlder, 100_000)).map((nearbyCase) => nearbyCase.id),
				[ids.touching, ids.near, ids.far]
			);
			assert.deepEqual(await findNearbyCases(dbClient, '22222222-2222-2222-2222-22222222ffff', 100_000), []);

			// drawn from their simplified geometry, for those touching the map's window
			const window = square(-35.1, 44.9);
			window.coordinates[0] = [
				[-35.1, 44.9],
				[-34.9, 44.9],
				[-34.9, 45.1],
				[-35.1, 45.1],
				[-35.1, 44.9]
			];
			const geometries = await getCaseBoundaryDisplayGeometries(dbClient, [ids.near, ids.far.toUpperCase()], window);
			assert.deepEqual([...geometries.keys()], [ids.near]);
			assert.equal(geometries.get(ids.near)?.type, 'Polygon');
			assert.deepEqual(await getCaseBoundaryDisplayGeometries(dbClient, [], window), new Map());
		} finally {
			await cleanupCases();
		}
	});
});
