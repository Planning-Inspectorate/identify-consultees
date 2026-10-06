import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import type { PrismaClient } from '../client/client.ts';
import { loadConfig } from '../configuration/config.ts';
import { newDatabaseClient } from '../index.ts';
import { RULESETS, runRuleset } from './rulesets.ts';
import { wktToGeometry } from './wkt.ts';

interface GoldenCase {
	caseReference: string;
	caseName: string;
	consultees: { id: string; category: string; consultee: string; distanceMetres: number }[];
}

// Expected example-ruleset results for five real projects (London, Somerset coast/nuclear,
// Wales/national park, offshore wind, and a unitary bordering a two-tier county), computed
// independently of this code - Python/shapely over the raw reference GeoJSON - so this checks the
// app's answers rather than restating them. They only hold against the full real reference dataset,
// so the suite skips itself unless that's what's loaded (CI only seeds a small sample).
const { cases } = JSON.parse(readFileSync(new URL('./ruleset-golden-cases.json', import.meta.url), 'utf8')) as {
	cases: GoldenCase[];
};
const FULL_DATASET_ROWS = 18_258;
// the expected distances are planar (British National Grid); the app's are geodesic - they agree to
// within ~0.03% on these cases, so allow a little more than that
const distanceTolerance = (metres: number) => Math.max(25, metres * 0.001);

let dbClient: PrismaClient;
let fullDatasetLoaded = false;

before(async () => {
	try {
		dbClient = newDatabaseClient(loadConfig().db);
		const [{ rows }] = await dbClient.$queryRaw<{ rows: number }[]>`SELECT COUNT(*) AS rows FROM consultee_area`;
		fullDatasetLoaded = rows === FULL_DATASET_ROWS;
	} catch {
		fullDatasetLoaded = false;
	}
});

after(async () => {
	await dbClient?.$disconnect();
});

describe('example ruleset against real projects (full reference dataset)', () => {
	for (const golden of cases) {
		test(`${golden.caseReference} ${golden.caseName}`, { timeout: 120_000 }, async (t) => {
			if (!fullDatasetLoaded) return t.skip('full reference dataset not loaded');
			const [project] = await dbClient.$queryRaw<{ wkt: string }[]>`
				SELECT TOP 1 geometry.STAsText() AS wkt FROM case_boundary WHERE caseReference = ${golden.caseReference} ORDER BY id
			`;
			if (!project) return t.skip(`${golden.caseReference} not loaded`);

			const { matches } = await runRuleset(dbClient, wktToGeometry(project.wkt), RULESETS[0]);

			const actual = new Map(matches.map((match) => [match.feature.id.toLowerCase(), match]));
			const missing = golden.consultees.filter((expected) => !actual.has(expected.id));
			const expectedIds = new Set(golden.consultees.map((expected) => expected.id));
			const unexpected = matches.filter((match) => !expectedIds.has(match.feature.id.toLowerCase()));
			assert.deepEqual(
				{
					missing: missing.map((c) => `${c.category}: ${c.consultee}`),
					unexpected: unexpected.map(
						(m) => `${m.feature.properties.consulteeCategory}: ${m.feature.properties.consultee}`
					)
				},
				{ missing: [], unexpected: [] }
			);

			for (const expected of golden.consultees) {
				const distance = actual.get(expected.id)!.distanceMetres;
				assert.ok(
					Math.abs(distance - expected.distanceMetres) <= distanceTolerance(expected.distanceMetres),
					`${expected.category}: ${expected.consultee} - expected ~${expected.distanceMetres}m, got ${Math.round(distance)}m`
				);
			}
		});
	}
});
