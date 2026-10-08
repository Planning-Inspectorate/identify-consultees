import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { PrismaClient } from '../client/client.ts';
import { loadConfig } from '../configuration/config.ts';
import { newDatabaseClient } from '../index.ts';
import type { ConsulteeAreaFeatureCollection } from './consultee-areas.ts';
import {
	bufferGeometryForDisplay,
	getConsulteeAreaById,
	getConsulteeAreaDisplayGeometries,
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
