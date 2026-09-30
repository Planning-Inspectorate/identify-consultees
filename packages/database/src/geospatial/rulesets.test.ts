import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { PrismaClient } from '../client/client.ts';
import { loadConfig } from '../configuration/config.ts';
import { newDatabaseClient } from '../index.ts';
import { loadConsulteeAreas } from './consultee-areas.ts';
import { getRuleset, runRuleset } from './rulesets.ts';

const testAreaId = '22222222-2222-2222-2222-222222222222';

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

describe('rulesets', () => {
	test('getRuleset finds a known ruleset by id and returns undefined for an unknown one', () => {
		const ruleset = getRuleset('railways-500m');
		assert.equal(ruleset?.name, 'Railways within 500m');
		assert.equal(getRuleset('not-a-real-ruleset'), undefined);
	});

	test('runRuleset only matches consultee areas in the ruleset’s categories, within its radius', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		await cleanup();
		try {
			await loadConsulteeAreas(dbClient, {
				type: 'FeatureCollection',
				features: [
					{
						id: testAreaId,
						type: 'Feature',
						geometry: { type: 'Point', coordinates: [0, 0] },
						properties: { consulteeCategory: 'Railway', consultee: 'Test Railway' }
					}
				]
			});

			const ruleset = getRuleset('railways-500m');
			assert.ok(ruleset);

			// well within the 500m radius
			const nearMatches = await runRuleset(dbClient, { type: 'Point', coordinates: [0.0001, 0.0001] }, ruleset);
			assert.ok(nearMatches.some((match) => match.feature.id === testAreaId));

			// a different ruleset's categories shouldn't match a Railway area
			const localCouncils = getRuleset('local-councils-5km');
			assert.ok(localCouncils);
			const wrongCategory = await runRuleset(dbClient, { type: 'Point', coordinates: [0.0001, 0.0001] }, localCouncils);
			assert.ok(!wrongCategory.some((match) => match.feature.id === testAreaId));

			// well outside the 500m radius
			const farMatches = await runRuleset(dbClient, { type: 'Point', coordinates: [10, 10] }, ruleset);
			assert.ok(!farMatches.some((match) => match.feature.id === testAreaId));
		} finally {
			await cleanup();
		}
	});
});
