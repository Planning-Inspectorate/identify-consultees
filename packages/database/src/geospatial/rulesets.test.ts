import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '../client/client.ts';
import { loadConfig } from '../configuration/config.ts';
import { newDatabaseClient } from '../index.ts';
import { readFeatures, toCaseBoundary } from '../seed/geojson-import.ts';
import { loadCaseBoundaries } from './case-boundaries.ts';
import { loadConsulteeAreas } from './consultee-areas.ts';
import type { Ruleset } from './rulesets.ts';
import {
	buildRulesetFromCsv,
	getRuleset,
	isDeadlockError,
	parseRulesetCsv,
	RULESETS,
	runRuleset,
	withDeadlockRetry
} from './rulesets.ts';

const testAreaId = '22222222-2222-2222-2222-222222222222';
const secondAreaId = '55555555-5555-5555-5555-555555555555';
const hostAreaId = '33333333-3333-3333-3333-333333333333';
const neighbourAreaId = '44444444-4444-4444-4444-444444444444';
const realCouncilAreaId = '66666666-6666-6666-6666-666666666666';
const realDistrictAreaId = '77777777-7777-7777-7777-777777777777';
const realPoliceAreaId = '88888888-8888-8888-8888-888888888888';
const realHospitalAreaId = '99999999-9999-9999-9999-999999999999';
const realAmbulanceAreaId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// apps/function-python/setup_database/sample_data/sample_application_boundaries.geojson includes a
// real project (EN0110019 - EcoPower Suffolk Solar) - using its real, complex geometry (rather than
// a synthetic Point/Polygon) is what proves the full real ruleset finds multiple relevant
// consultees for an actual project, not just for conveniently-shaped test fixtures.
const sampleDataDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../../apps/function-python/setup_database/sample_data'
);

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
	await dbClient.$executeRaw`
		DELETE FROM consultee_area WHERE id IN (
			${testAreaId}, ${secondAreaId}, ${hostAreaId}, ${neighbourAreaId},
			${realCouncilAreaId}, ${realDistrictAreaId}, ${realPoliceAreaId}, ${realHospitalAreaId}, ${realAmbulanceAreaId}
		)
	`;
}

describe('parseRulesetCsv', () => {
	const header =
		'consulteeName\treferenceData\tconsulteeDescription\tmatchingConsulteeType\thostType\tlogicDescription\tlogicType\tintersectionBufferKm';

	test('resolves the matching category from referenceData when set', () => {
		const [rule] = parseRulesetCsv(`${header}\nrailway\trail_epsg27700\tRailways\t\t\tIntersects\tintersection\t10`);
		assert.deepEqual(rule, {
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
		const [rule] = parseRulesetCsv(
			`${header}\na_bordering_b\t\tBordering\tparish\tparish\tBordering host authority\tbordering\t0`
		);
		assert.equal(rule.logicType, 'bordering');
		assert.deepEqual(rule.categories, ['Parish Council']);
		assert.equal(rule.hostCategory, 'Parish Council');
		assert.equal(rule.bufferMetres, undefined);
	});

	test('passes through an unmapped identifier unchanged rather than dropping it', () => {
		const [rule] = parseRulesetCsv(`${header}\ncanal\tcanals_epsg27700\tCanals\t\t\tIntersects\tintersection\t10`);
		// no reference data has this category loaded yet - the condition still exists, it just
		// won't match anything until it does
		assert.deepEqual(rule.categories, ['canals_epsg27700']);
	});

	test('throws on a CSV missing an expected column', () => {
		assert.throws(() => parseRulesetCsv('a\tb\tc\n1\t2\t3'), /missing expected column/);
	});
});

describe('buildRulesetFromCsv', () => {
	const header =
		'consulteeName\treferenceData\tconsulteeDescription\tmatchingConsulteeType\thostType\tlogicDescription\tlogicType\tintersectionBufferKm';

	test('wraps every row of a CSV export as one ruleset', () => {
		const ruleset = buildRulesetFromCsv(
			'test-ruleset',
			'Test ruleset',
			`${header}\nrailway\trail_epsg27700\tRailways\t\t\tIntersects\tintersection\t10\nhospital\t\tHospitals\t\t\tIntersects\tintersection\t10`
		);
		assert.equal(ruleset.id, 'test-ruleset');
		assert.equal(ruleset.name, 'Test ruleset');
		assert.equal(ruleset.rules.length, 2);
		assert.deepEqual(
			ruleset.rules.map((rule) => rule.id),
			['railway', 'hospital']
		);
	});
});

describe('isDeadlockError', () => {
	test('recognises a SQL Server deadlock message', () => {
		assert.ok(isDeadlockError(new Error('Transaction was deadlocked on lock resources...')));
		assert.ok(isDeadlockError(new Error('DEADLOCK detected')));
	});

	test('does not misclassify other errors', () => {
		assert.ok(!isDeadlockError(new Error('Timeout: Request failed to complete in 15000ms')));
		assert.ok(!isDeadlockError('not an Error instance'));
		assert.ok(!isDeadlockError(undefined));
	});
});

describe('withDeadlockRetry', () => {
	test('returns the result on the first success without retrying', async () => {
		const fn = async () => 'ok';
		assert.equal(await withDeadlockRetry(fn), 'ok');
	});

	test('retries on a deadlock and returns the eventual success', async () => {
		let attempts = 0;
		const fn = async () => {
			attempts += 1;
			if (attempts < 3) {
				throw new Error('deadlocked on lock resources');
			}
			return 'ok';
		};
		assert.equal(await withDeadlockRetry(fn), 'ok');
		assert.equal(attempts, 3);
	});

	test('gives up after the retry limit and rethrows the deadlock error', async () => {
		const fn = async () => {
			throw new Error('deadlocked on lock resources');
		};
		await assert.rejects(() => withDeadlockRetry(fn, 2), /deadlocked/);
	});

	test('retries on a lock-wait timeout (not a detected deadlock, but the same underlying cause)', async () => {
		let attempts = 0;
		const fn = async () => {
			attempts += 1;
			if (attempts < 2) {
				throw new Error('Timeout: Request failed to complete in 15000ms');
			}
			return 'ok';
		};
		assert.equal(await withDeadlockRetry(fn), 'ok');
		assert.equal(attempts, 2);
	});

	test('rethrows a non-deadlock error immediately, without retrying', async () => {
		let attempts = 0;
		const fn = async () => {
			attempts += 1;
			throw new Error('some other error');
		};
		await assert.rejects(() => withDeadlockRetry(fn), /some other error/);
		assert.equal(attempts, 1);
	});
});

describe('rulesets registry', () => {
	test('loads exactly the one real ruleset from the sample data export, with its conditions', () => {
		assert.equal(RULESETS.length, 1);
		const [ruleset] = RULESETS;
		assert.ok(ruleset.id && ruleset.name);
		assert.ok(ruleset.rules.length > 1, 'expected the real export to contain more than one condition');
	});

	test('getRuleset finds a known ruleset by id and returns undefined for an unknown one', () => {
		const ruleset = getRuleset('example-ruleset');
		assert.ok(ruleset);
		assert.equal(getRuleset('not-a-real-ruleset'), undefined);
	});
});

describe('runRuleset', () => {
	test("only matches consultee areas in a condition's categories, within its buffer (intersection)", async (t) => {
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

			const railwayRuleset: Ruleset = {
				id: 'railway-only',
				name: 'Railway only',
				rules: [
					{ id: 'railway', name: 'Railways', logicType: 'intersection', categories: ['Railway'], bufferMetres: 10_000 }
				]
			};

			// well within the 10km buffer
			const { matches: nearMatches } = await runRuleset(
				dbClient,
				{ type: 'Point', coordinates: [0.001, 0.001] },
				railwayRuleset
			);
			assert.ok(nearMatches.some((match) => match.feature.id === testAreaId));

			// a ruleset whose only condition targets a different category shouldn't match a Railway area
			const hospitalRuleset: Ruleset = {
				id: 'hospital-only',
				name: 'Hospital only',
				rules: [
					{
						id: 'hospital',
						name: 'Hospitals',
						logicType: 'intersection',
						categories: ['Hospital'],
						bufferMetres: 10_000
					}
				]
			};
			const { matches: wrongCategory } = await runRuleset(
				dbClient,
				{ type: 'Point', coordinates: [0.001, 0.001] },
				hospitalRuleset
			);
			assert.ok(!wrongCategory.some((match) => match.feature.id === testAreaId));

			// well outside the 10km buffer
			const { matches: farMatches } = await runRuleset(
				dbClient,
				{ type: 'Point', coordinates: [10, 10] },
				railwayRuleset
			);
			assert.ok(!farMatches.some((match) => match.feature.id === testAreaId));
		} finally {
			await cleanup();
		}
	});

	test('combines matches from every condition in the ruleset, deduplicated', async (t) => {
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
					},
					{
						id: secondAreaId,
						type: 'Feature',
						geometry: { type: 'Point', coordinates: [0, 0] },
						properties: { consulteeCategory: 'Hospital', consultee: 'Test Hospital' }
					}
				]
			});

			// a ruleset with two conditions, each targeting a different category, plus a third
			// condition targeting the *same* category as the first (to prove overlapping matches are
			// deduplicated rather than returned twice)
			const ruleset: Ruleset = {
				id: 'multi-condition',
				name: 'Multi-condition',
				rules: [
					{ id: 'railway', name: 'Railways', logicType: 'intersection', categories: ['Railway'], bufferMetres: 10_000 },
					{
						id: 'hospital',
						name: 'Hospitals',
						logicType: 'intersection',
						categories: ['Hospital'],
						bufferMetres: 10_000
					},
					{
						id: 'railway-again',
						name: 'Railways (again)',
						logicType: 'intersection',
						categories: ['Railway'],
						bufferMetres: 20_000
					}
				]
			};

			const { matches } = await runRuleset(dbClient, { type: 'Point', coordinates: [0.001, 0.001] }, ruleset);
			const ids = matches.map((match) => match.feature.id).sort();
			assert.deepEqual(ids, [testAreaId, secondAreaId].sort());
		} finally {
			await cleanup();
		}
	});

	test('orders matches tied at the same distance deterministically, by id', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		await cleanup();
		try {
			// both areas intersect the same point (distance 0) - with no tiebreaker, their relative
			// order isn't guaranteed to be stable across repeated runs of the same query
			await loadConsulteeAreas(dbClient, {
				type: 'FeatureCollection',
				features: [
					{
						id: testAreaId,
						type: 'Feature',
						geometry: { type: 'Point', coordinates: [0, 0] },
						properties: { consulteeCategory: 'Railway', consultee: 'Test Railway' }
					},
					{
						id: secondAreaId,
						type: 'Feature',
						geometry: { type: 'Point', coordinates: [0, 0] },
						properties: { consulteeCategory: 'Railway', consultee: 'Test Railway 2' }
					}
				]
			});

			const ruleset: Ruleset = {
				id: 'tie-break',
				name: 'Tie break',
				rules: [
					{ id: 'railway', name: 'Railways', logicType: 'intersection', categories: ['Railway'], bufferMetres: 0 }
				]
			};

			const runs = await Promise.all(
				Array.from({ length: 5 }, () => runRuleset(dbClient, { type: 'Point', coordinates: [0, 0] }, ruleset))
			);
			const orderings = runs.map(({ matches }) => matches.map((match) => match.feature.id).join(','));
			assert.ok(
				orderings.every((ordering) => ordering === orderings[0]),
				`expected every run to return matches in the same order, got: ${orderings.join(' | ')}`
			);
			assert.deepEqual(orderings[0].split(','), [testAreaId, secondAreaId].sort());
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

			const borderingRuleset: Ruleset = {
				id: 'bordering-only',
				name: 'Bordering only',
				rules: [
					{
						id: 'a_bordering_b_host_parish_comm_council',
						name: 'Bordering parishes',
						logicType: 'bordering',
						categories: ['Parish Council'],
						hostCategory: 'Parish Council'
					}
				]
			};

			// a point inside the host parish
			const { matches } = await runRuleset(dbClient, { type: 'Point', coordinates: [0.5, 0.5] }, borderingRuleset);
			assert.ok(matches.some((match) => match.feature.id === neighbourAreaId));
			assert.ok(!matches.some((match) => match.feature.id === hostAreaId));
		} finally {
			await cleanup();
		}
	});

	test('returns no matches for a bordering condition with no resolvable host category', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');
		const ruleset: Ruleset = {
			id: 'no-host',
			name: 'No host',
			rules: [{ id: 'no_host', name: 'No host', logicType: 'bordering', categories: ['Parish Council'] }]
		};
		const { matches } = await runRuleset(dbClient, { type: 'Point', coordinates: [0, 0] }, ruleset);
		assert.deepEqual(matches, []);
	});

	test('allNearby includes every nearby area regardless of category, excludes anything beyond the radius', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		await cleanup();
		try {
			await loadConsulteeAreas(dbClient, {
				type: 'FeatureCollection',
				features: [
					{
						id: testAreaId,
						type: 'Feature',
						// a category with no condition in this ad-hoc ruleset at all - allNearby should
						// still surface it, since it isn't filtered by what the ruleset itself checks for
						geometry: { type: 'Point', coordinates: [0, 0] },
						properties: { consulteeCategory: 'Electricity Generator', consultee: 'Test Generator' }
					}
				]
			});

			// far enough outside the test's custom 1km radius below
			const ruleset: Ruleset = { id: 'empty', name: 'Empty', rules: [] };
			const { allNearby } = await runRuleset(dbClient, { type: 'Point', coordinates: [0.001, 0.001] }, ruleset, 1_000);

			const nearbyIds = new Set(allNearby.map((match) => match.feature.id));
			assert.ok(nearbyIds.has(testAreaId), 'expected an Electricity Generator area to appear in allNearby');

			const { allNearby: farAway } = await runRuleset(
				dbClient,
				{ type: 'Point', coordinates: [10, 10] },
				ruleset,
				1_000
			);
			assert.deepEqual(farAway, []);
		} finally {
			await cleanup();
		}
	});

	test('allNearby excludes Railway even when within radius, since its reference data is a single nationwide geometry', async (t) => {
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

			const ruleset: Ruleset = { id: 'empty', name: 'Empty', rules: [] };
			const { allNearby } = await runRuleset(dbClient, { type: 'Point', coordinates: [0, 0] }, ruleset, 1_000);

			assert.ok(
				!allNearby.some((match) => match.feature.id === testAreaId),
				'expected Railway to be excluded from allNearby despite being exactly on the site'
			);
		} finally {
			await cleanup();
		}
	});
});

describe('runRuleset against a real project (EN0110019 - EcoPower Suffolk Solar)', () => {
	test('finds multiple relevant consultees across multiple categories for a real project', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		// the real project's own geometry (181-vertex polygon) - loaded from the same checked-in
		// file the app itself seeds from, not hand-written, so this test exercises the real shape
		const rawFeatures = await readFeatures(path.join(sampleDataDir, 'sample_application_boundaries.geojson'));
		const realFeature = rawFeatures.find((feature) => feature.properties.caseReference === 'EN0110019');
		assert.ok(realFeature, 'expected EN0110019 to still be present in the sample application boundaries export');
		const project = toCaseBoundary(realFeature);

		await cleanup();
		await dbClient.$executeRaw`DELETE FROM case_boundary WHERE id = ${project.id}`;
		try {
			await loadCaseBoundaries(dbClient, { type: 'FeatureCollection', features: [project] });

			// realistic categories/distances for this real project, derived from actually running
			// the full real reference dataset (18k+ real UK consultee areas) against it locally -
			// not arbitrary: a county and district council whose boundary contains the site, a
			// police force area doing the same, and a hospital/railway within their real 10km
			// intersection buffer (see example_ruleset.csv) - this is the real-world shape a correct
			// ruleset run should find, not just a single category.
			await loadConsulteeAreas(dbClient, {
				type: 'FeatureCollection',
				features: [
					{
						id: realCouncilAreaId,
						type: 'Feature',
						geometry: project.geometry,
						properties: { consulteeCategory: 'Upper Tier Authority', consultee: 'Suffolk County Council' }
					},
					{
						id: realDistrictAreaId,
						type: 'Feature',
						geometry: project.geometry,
						properties: { consulteeCategory: 'Lower Tier Authority', consultee: 'Mid Suffolk District Council' }
					},
					{
						id: realPoliceAreaId,
						type: 'Feature',
						geometry: project.geometry,
						properties: { consulteeCategory: 'Police', consultee: 'Suffolk Constabulary' }
					},
					{
						id: realHospitalAreaId,
						type: 'Feature',
						// ~6.5km from the site - within the Hospital condition's real 10km buffer
						geometry: { type: 'Point', coordinates: [1.1828714294908717, 52.38917544689788] },
						properties: { consulteeCategory: 'Hospital', consultee: 'Hartismere Hospital' }
					},
					{
						id: realAmbulanceAreaId,
						type: 'Feature',
						// ~5.6km from the site - within the Ambulance Trust condition's real 10km buffer
						geometry: { type: 'Point', coordinates: [1.2028714294908717, 52.33917544689788] },
						properties: { consulteeCategory: 'Ambulance Trust', consultee: 'Test Ambulance Trust' }
					}
				]
			});

			const { matches, allNearby } = await runRuleset(dbClient, project.geometry, RULESETS[0]);

			const categories = new Set(matches.map((match) => match.feature.properties.consulteeCategory));
			assert.ok(
				matches.length >= 5,
				`expected a real project to find multiple consultees, got ${matches.length}: ${JSON.stringify(matches.map((m) => m.feature.properties.consultee))}`
			);
			for (const expectedCategory of [
				'Upper Tier Authority',
				'Lower Tier Authority',
				'Police',
				'Hospital',
				'Ambulance Trust'
			]) {
				assert.ok(categories.has(expectedCategory), `expected a match in category "${expectedCategory}"`);
			}

			// allNearby is the default "everyone nearby" view - every fixture here is well within the
			// default 20km radius, so all five should appear regardless of category
			const nearbyIds = new Set(allNearby.map((match) => match.feature.id));
			for (const id of [
				realCouncilAreaId,
				realDistrictAreaId,
				realPoliceAreaId,
				realHospitalAreaId,
				realAmbulanceAreaId
			]) {
				assert.ok(nearbyIds.has(id), `expected allNearby to include fixture ${id}`);
			}
		} finally {
			await cleanup();
			await dbClient.$executeRaw`DELETE FROM case_boundary WHERE id = ${project.id}`;
		}
	});
});
