import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { PrismaClient } from '../client/client.ts';
import { loadConfig } from '../configuration/config.ts';
import { newDatabaseClient } from '../index.ts';
import type { CaseBoundaryFeatureCollection } from './case-boundaries.ts';
import {
	findCaseBoundariesIntersecting,
	findCaseBoundariesNear,
	getCaseBoundaryById,
	getCaseBoundarySummaryById,
	getRandomCaseSummary,
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
	} catch {
		dbAvailable = false;
	}
});

after(async () => {
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

			// a point inside the stored polygon
			const insidePoint = { type: 'Point' as const, coordinates: [-0.1276, 51.5072] as [number, number] };
			const nearMatches = await findCaseBoundariesNear(dbClient, insidePoint, 5000);
			assert.ok(nearMatches.some((match) => match.feature.id === testBoundaryId));

			const intersecting = await findCaseBoundariesIntersecting(dbClient, insidePoint);
			assert.ok(intersecting.features.some((feature) => feature.id === testBoundaryId));

			// Paris is a long way from the stored London polygon - shouldn't match a 1km radius
			const farPoint = { type: 'Point' as const, coordinates: [2.3522, 48.8566] as [number, number] };
			const farMatches = await findCaseBoundariesNear(dbClient, farPoint, 1000);
			assert.ok(!farMatches.some((match) => match.feature.id === testBoundaryId));
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

	test('getRandomCaseSummary returns a real reference and case name', async (t) => {
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

			const summary = await getRandomCaseSummary(dbClient);
			assert.ok(summary);
			assert.ok(summary.reference);
			assert.ok(summary.caseName);
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
});
