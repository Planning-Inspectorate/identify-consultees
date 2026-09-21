import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { PrismaClient } from '../client/client.ts';
import { loadConfig } from '../configuration/config.ts';
import { newDatabaseClient } from '../index.ts';
import type { CaseBoundaryFeatureCollection } from './case-boundaries.ts';
import {
	findCaseBoundariesIntersecting,
	findCaseBoundariesNear,
	listCaseBoundaries,
	loadCaseBoundaries
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
});
