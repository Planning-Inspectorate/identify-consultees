import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { PrismaClient } from '../client/client.ts';
import { loadConfig } from '../configuration/config.ts';
import { newDatabaseClient } from '../index.ts';
import { loadConsulteeAreas } from './consultee-areas.ts';
import { getRuleset, parseRulesetCsv, RULESETS, runRuleset } from './rulesets.ts';

const testAreaId = '22222222-2222-2222-2222-222222222222';
const hostAreaId = '33333333-3333-3333-3333-333333333333';
const neighbourAreaId = '44444444-4444-4444-4444-444444444444';

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
	await dbClient.$executeRaw`DELETE FROM consultee_area WHERE id IN (${testAreaId}, ${hostAreaId}, ${neighbourAreaId})`;
}

describe('parseRulesetCsv', () => {
	const header =
		'consulteeName\treferenceData\tconsulteeDescription\tmatchingConsulteeType\thostType\tlogicDescription\tlogicType\tintersectionBufferKm';

	test('resolves the matching category from referenceData when set', () => {
		const [ruleset] = parseRulesetCsv(`${header}\nrailway\trail_epsg27700\tRailways\t\t\tIntersects\tintersection\t10`);
		assert.deepEqual(ruleset, {
			id: 'railway',
			name: 'Railways',
			logicType: 'intersection',
			categories: ['Railway'],
			bufferMetres: 10000
		});
	});

	test('falls back to matchingConsulteeType (splitting on ";"), then consulteeName', () => {
		const [withType] = parseRulesetCsv(
			`${header}\nb_host\t\tHost\tparish; unitary_auth\t\tIntersects\tintersection\t0`
		);
		assert.deepEqual(withType.categories, ['Parish Council', 'Unitary Authority']);

		const [bareName] = parseRulesetCsv(`${header}\nhospital\t\tHospitals\t\t\tIntersects\tintersection\t10`);
		assert.deepEqual(bareName.categories, ['Hospital']);
	});

	test('parses a bordering rule with a host category', () => {
		const [ruleset] = parseRulesetCsv(
			`${header}\na_bordering_b\t\tBordering\tparish\tparish\tBordering host authority\tbordering\t0`
		);
		assert.equal(ruleset.logicType, 'bordering');
		assert.deepEqual(ruleset.categories, ['Parish Council']);
		assert.equal(ruleset.hostCategory, 'Parish Council');
		assert.equal(ruleset.bufferMetres, undefined);
	});

	test('passes through an unmapped identifier unchanged rather than dropping it', () => {
		const [ruleset] = parseRulesetCsv(`${header}\ncanal\tcanals_epsg27700\tCanals\t\t\tIntersects\tintersection\t10`);
		// no reference data has this category loaded yet - the ruleset still exists, it just
		// won't match anything until it does
		assert.deepEqual(ruleset.categories, ['canals_epsg27700']);
	});

	test('throws on a CSV missing an expected column', () => {
		assert.throws(() => parseRulesetCsv('a\tb\tc\n1\t2\t3'), /missing expected column/);
	});
});

describe('rulesets registry', () => {
	test('loads real rulesets from the sample data export', () => {
		assert.ok(RULESETS.length > 0);
		assert.ok(RULESETS.every((ruleset) => ruleset.id && ruleset.name));
	});

	test('getRuleset finds a known ruleset by id and returns undefined for an unknown one', () => {
		const ruleset = getRuleset('railway');
		assert.equal(ruleset?.name, 'Railways');
		assert.equal(getRuleset('not-a-real-ruleset'), undefined);
	});
});

describe('runRuleset', () => {
	test("only matches consultee areas in the ruleset's categories, within its buffer (intersection)", async (t) => {
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

			const railway = getRuleset('railway');
			assert.ok(railway);

			// well within the 10km buffer
			const nearMatches = await runRuleset(dbClient, { type: 'Point', coordinates: [0.001, 0.001] }, railway);
			assert.ok(nearMatches.some((match) => match.feature.id === testAreaId));

			// a different ruleset's categories shouldn't match a Railway area
			const hospital = getRuleset('hospital');
			assert.ok(hospital);
			const wrongCategory = await runRuleset(dbClient, { type: 'Point', coordinates: [0.001, 0.001] }, hospital);
			assert.ok(!wrongCategory.some((match) => match.feature.id === testAreaId));

			// well outside the 10km buffer
			const farMatches = await runRuleset(dbClient, { type: 'Point', coordinates: [10, 10] }, railway);
			assert.ok(!farMatches.some((match) => match.feature.id === testAreaId));
		} finally {
			await cleanup();
		}
	});

	test('finds a bordering area of a host that intersects the site, not the host itself', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		await cleanup();
		try {
			await loadConsulteeAreas(dbClient, {
				type: 'FeatureCollection',
				features: [
					{
						id: hostAreaId,
						type: 'Feature',
						geometry: {
							type: 'Polygon',
							coordinates: [
								[
									[0, 0],
									[1, 0],
									[1, 1],
									[0, 1],
									[0, 0]
								]
							]
						},
						properties: { consulteeCategory: 'Parish Council', consultee: 'Host Parish' }
					},
					{
						id: neighbourAreaId,
						type: 'Feature',
						// shares the edge from (1,0) to (1,1) with the host - a true neighbour
						geometry: {
							type: 'Polygon',
							coordinates: [
								[
									[1, 0],
									[2, 0],
									[2, 1],
									[1, 1],
									[1, 0]
								]
							]
						},
						properties: { consulteeCategory: 'Parish Council', consultee: 'Neighbour Parish' }
					}
				]
			});

			const ruleset = getRuleset('a_bordering_b_host_parish_comm_council');
			assert.ok(ruleset);
			assert.equal(ruleset.logicType, 'bordering');

			// a point inside the host parish
			const matches = await runRuleset(dbClient, { type: 'Point', coordinates: [0.5, 0.5] }, ruleset);
			assert.ok(matches.some((match) => match.feature.id === neighbourAreaId));
			assert.ok(!matches.some((match) => match.feature.id === hostAreaId));
		} finally {
			await cleanup();
		}
	});

	test('returns no matches for a bordering ruleset with no resolvable host category', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');
		const [ruleset] = parseRulesetCsv(
			'consulteeName\treferenceData\tconsulteeDescription\tmatchingConsulteeType\thostType\tlogicDescription\tlogicType\tintersectionBufferKm\nno_host\t\tNo host\tparish\t\tBordering\tbordering\t0'
		);
		assert.equal(ruleset.hostCategory, undefined);
		const matches = await runRuleset(dbClient, { type: 'Point', coordinates: [0, 0] }, ruleset);
		assert.deepEqual(matches, []);
	});
});
