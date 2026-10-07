import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import type { PrismaClient } from '../client/client.ts';
import { loadConfig } from '../configuration/config.ts';
import { newDatabaseClient } from '../index.ts';
import { RULESETS, runRuleset } from './rulesets.ts';
import { wktToGeometry } from './wkt.ts';

interface GoldenConsultee {
	id: string;
	category: string;
	consultee: string;
}

interface GoldenCase {
	caseReference: string;
	caseName: string;
	mustInclude: GoldenConsultee[];
	mayAlsoInclude: GoldenConsultee[];
}

// Expected example-ruleset results for five real projects (London, Somerset coast/nuclear,
// Wales/national park, offshore wind, and a unitary bordering a two-tier county), computed
// independently of this code - Python/shapely over the raw reference GeoJSON - so this checks the
// app's answers rather than restating them. The app works on simplified geometries and includes
// borderline consultees rather than risk missing one, so it must return every exact match, and
// anything extra must be one a deliberately generous calculation also finds. They only hold
// against the full real reference dataset, so the suite skips itself unless that's what's loaded
// (CI only seeds a small sample).
const { cases } = JSON.parse(readFileSync(new URL('./ruleset-golden-cases.json', import.meta.url), 'utf8')) as {
	cases: GoldenCase[];
};
const FULL_DATASET_ROWS = 18_258;

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

			const actualIds = new Set(matches.map((match) => match.feature.id.toLowerCase()));
			const allowedIds = new Set([...golden.mustInclude, ...golden.mayAlsoInclude].map((c) => c.id));
			assert.deepEqual(
				{
					missing: golden.mustInclude.filter((c) => !actualIds.has(c.id)).map((c) => `${c.category}: ${c.consultee}`),
					unexpected: matches
						.filter((match) => !allowedIds.has(match.feature.id.toLowerCase()))
						.map((match) => `${match.feature.properties.consulteeCategory}: ${match.feature.properties.consultee}`)
				},
				{ missing: [], unexpected: [] }
			);
		});
	}
});
