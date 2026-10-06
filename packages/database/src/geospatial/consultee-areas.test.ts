import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { PrismaClient } from '../client/client.ts';
import { loadConfig } from '../configuration/config.ts';
import { newDatabaseClient } from '../index.ts';
import type { ConsulteeAreaFeatureCollection } from './consultee-areas.ts';
import {
	findConsulteeAreasIntersecting,
	findConsulteeAreasNear,
	getConsulteeAreaById,
	loadConsulteeAreas
} from './consultee-areas.ts';

// a fixed id, rather than a wholesale table truncate, so this suite can't wipe out other data in
// a shared local dev database
const testAreaId = '11111111-1111-1111-1111-111111111111';

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
	await dbClient.$executeRaw`DELETE FROM consultee_area WHERE id = ${testAreaId}`;
}

describe('consultee areas (requires a local SQL Server - see docker-compose.yml)', () => {
	test('load, list, findNear and findIntersecting round-trip a stored area', async (t) => {
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

			// a point inside the stored polygon
			const insidePoint = { type: 'Point' as const, coordinates: [-0.1276, 51.5072] as [number, number] };
			const nearMatches = await findConsulteeAreasNear(dbClient, insidePoint, 5000);
			assert.ok(nearMatches.some((match) => match.feature.id === testAreaId));

			const intersecting = await findConsulteeAreasIntersecting(dbClient, insidePoint);
			assert.ok(intersecting.features.some((feature) => feature.id === testAreaId));

			// Paris is a long way from the stored London polygon - shouldn't match a 1km radius
			const farPoint = { type: 'Point' as const, coordinates: [2.3522, 48.8566] as [number, number] };
			const farMatches = await findConsulteeAreasNear(dbClient, farPoint, 1000);
			assert.ok(!farMatches.some((match) => match.feature.id === testAreaId));

			// consulteeCategories filters to those categories only
			const rightCategory = await findConsulteeAreasNear(dbClient, insidePoint, 5000, ['Environment Agency']);
			assert.ok(rightCategory.some((match) => match.feature.id === testAreaId));

			const wrongCategory = await findConsulteeAreasNear(dbClient, insidePoint, 5000, ['railway']);
			assert.ok(!wrongCategory.some((match) => match.feature.id === testAreaId));

			// excludeCategories drops a category even with no consulteeCategories filter at all -
			// the "any category" query runRuleset's allNearby uses (see rulesets.ts)
			const excluded = await findConsulteeAreasNear(dbClient, insidePoint, 5000, undefined, ['Environment Agency']);
			assert.ok(!excluded.some((match) => match.feature.id === testAreaId));

			const notExcluded = await findConsulteeAreasNear(dbClient, insidePoint, 5000, undefined, ['railway']);
			assert.ok(notExcluded.some((match) => match.feature.id === testAreaId));
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
});
