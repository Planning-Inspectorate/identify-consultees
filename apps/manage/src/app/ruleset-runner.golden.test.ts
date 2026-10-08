import { newDatabaseClient } from '@pins/identify-consultees-database';
import type { PrismaClient } from '@pins/identify-consultees-database/src/client/client.ts';
import { RULESETS } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { wktToGeometry } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import type { RulesetRunner } from './ruleset-runner.ts';
import { buildPythonRulesetRunner } from './ruleset-runner.ts';

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

// Expected England Wales post 30 April 2024 ruleset results for five real projects (London, Somerset coast/nuclear,
// Wales/national park, offshore wind, and a unitary bordering a two-tier county), computed
// independently of the app - Python/shapely over the raw reference GeoJSON - so this checks its
// answers rather than restating them. The ruleset runs on simplified geometries and includes
// borderline consultees rather than risk missing one, so it must return every exact match, and
// anything extra must be one a deliberately generous calculation also finds.
//
// End to end, as the app runs it: this app's ruleset definitions, sent to the running Python
// function (`npm start` launches it), against the full real reference dataset. It skips itself
// unless both are available - CI seeds only a small sample and doesn't run the function.
const { cases } = JSON.parse(readFileSync(new URL('./ruleset-golden-cases.json', import.meta.url), 'utf8')) as {
	cases: GoldenCase[];
};
const FULL_DATASET_ROWS = 18_258;
const LOCAL_DATABASE =
	'sqlserver://localhost:1434;database=identify-consultees;user=sa;password=DockerDatabaseP@22word!;trustServerCertificate=true';
const PYTHON_FUNCTION_URL = process.env.PYTHON_FUNCTION_URL ?? 'http://localhost:7071/api/consultee-areas';

let dbClient: PrismaClient;
let skipReason: string | undefined;
let runRuleset: RulesetRunner;

before(async () => {
	try {
		dbClient = newDatabaseClient(process.env.SQL_CONNECTION_STRING ?? LOCAL_DATABASE);
		const [{ rows }] = await dbClient.$queryRaw<{ rows: number }[]>`SELECT COUNT(*) AS rows FROM consultee_area`;
		if (rows !== FULL_DATASET_ROWS) {
			skipReason = 'full reference dataset not loaded';
			return;
		}
	} catch {
		skipReason = 'SQL Server database not available';
		return;
	}
	try {
		await fetch(new URL('health', PYTHON_FUNCTION_URL), { signal: AbortSignal.timeout(2_000) });
	} catch {
		skipReason = 'Python function not running';
		return;
	}
	runRuleset = buildPythonRulesetRunner({
		pythonFunctionUrl: PYTHON_FUNCTION_URL,
		apiKey: process.env.PYTHON_FUNCTION_API_KEY
	});
});

after(async () => {
	await dbClient?.$disconnect();
});

describe('England Wales post 30 April 2024 ruleset against real projects (full reference dataset, via the Python function)', () => {
	for (const golden of cases) {
		test(`${golden.caseReference} ${golden.caseName}`, { timeout: 120_000 }, async (t) => {
			if (skipReason) return t.skip(skipReason);
			const [project] = await dbClient.$queryRaw<{ wkt: string }[]>`
				SELECT TOP 1 geometry.STAsText() AS wkt FROM case_boundary WHERE caseReference = ${golden.caseReference} ORDER BY id
			`;
			if (!project) return t.skip(`${golden.caseReference} not loaded`);

			const { matches } = await runRuleset(wktToGeometry(project.wkt), RULESETS[0], 20_000);

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
