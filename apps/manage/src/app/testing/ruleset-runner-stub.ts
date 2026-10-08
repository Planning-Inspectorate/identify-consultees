import type { PrismaClient } from '@pins/identify-consultees-database/src/client/client.ts';
import { geometryToWkt } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';
import { mock } from 'node:test';
import type { RulesetRunner } from '../ruleset-runner.ts';
import { toRunRulesetResult } from '../ruleset-runner.ts';

/** A consultee_area row as the tests' fixtures describe one - the shape the Python function reads. */
export interface ConsulteeAreaMatchRow {
	id: string;
	consulteeCategory: string | null;
	consultee: string | null;
	region: string | null;
	caseReference?: string | null;
	documentId?: string | null;
	consulteeId?: string | null;
	organisationId?: string | null;
	currentVersion?: number;
	metadata?: string;
	geometryWkt: string;
	distanceMetres: number;
}

function feature(row: ConsulteeAreaMatchRow) {
	return {
		id: row.id,
		properties: {
			consulteeCategory: row.consulteeCategory,
			consultee: row.consultee,
			region: row.region,
			caseReference: row.caseReference ?? null,
			documentId: row.documentId ?? null,
			consulteeId: row.consulteeId ?? null,
			organisationId: row.organisationId ?? null,
			currentVersion: row.currentVersion ?? 1,
			metadata: JSON.parse(row.metadata ?? '{}')
		},
		geometryWkt: row.geometryWkt
	};
}

/**
 * Stands in for the Python function: resolves with `matches` (and `nearby` as the all-nearby list,
 * by default the same rows), passed through the real response mapping.
 */
export function rulesetRunnerReturning(
	matches: ConsulteeAreaMatchRow[],
	nearby: ConsulteeAreaMatchRow[] = matches
): RulesetRunner & ReturnType<typeof mock.fn> {
	return mock.fn<RulesetRunner>(async () =>
		toRunRulesetResult({
			matches: matches.map((row) => ({ feature: feature(row), distanceMetres: row.distanceMetres })),
			// listed, never drawn - the function sends nearby areas without geometry
			allNearby: nearby.map((row) => {
				const { id, properties } = feature(row);
				return { feature: { id, properties }, distanceMetres: row.distanceMetres };
			})
		})
	) as RulesetRunner & ReturnType<typeof mock.fn>;
}

/** Stands in for a Python function that's down, timed out or errored. */
export function failingRulesetRunner(): RulesetRunner & ReturnType<typeof mock.fn> {
	return mock.fn<RulesetRunner>(async () => {
		throw new Error('Python function run-ruleset responded with status 500');
	}) as RulesetRunner & ReturnType<typeof mock.fn>;
}

/**
 * A rough, database-backed stand-in for the Python function, for the integration and Playwright
 * tests: the app's pages need real-looking matches from the seeded data to click through, but CI
 * doesn't run the function. Only `intersection` conditions, one query, no simplification margins or
 * bordering logic - the real intersection logic is tested in apps/function-python.
 */
export function buildDatabaseRulesetRunner(getDb: () => PrismaClient): RulesetRunner {
	return async (site, ruleset, nearbyRadiusMetres) => {
		const db = getDb();
		const wkt = geometryToWkt(site);
		const rules = ruleset.rules.filter((rule) => rule.logicType === 'intersection' && rule.categories.length > 0);
		const searchMetres = Math.max(nearbyRadiusMetres, ...rules.map((rule) => rule.bufferMetres ?? 0));
		const rows = await db.$queryRaw<(ConsulteeAreaMatchRow & { metadata: string })[]>`
			SELECT id, consulteeCategory, consultee, region, caseReference, documentId, consulteeId, organisationId,
				currentVersion, metadata, geometry.STAsText() AS geometryWkt,
				geometrySimplified.STDistance(geography::STGeomFromText(${wkt}, 4326)) AS distanceMetres
			FROM consultee_area
			WHERE geometrySimplified.STDistance(geography::STGeomFromText(${wkt}, 4326)) <= ${searchMetres}
				AND (consulteeCategory IS NULL OR consulteeCategory <> 'Railway')
			ORDER BY distanceMetres, id
		`;
		const matches = rows.filter((row) =>
			rules.some(
				(rule) =>
					rule.categories.includes(row.consulteeCategory ?? '') && row.distanceMetres <= (rule.bufferMetres ?? 0)
			)
		);
		const nearby = rows.filter((row) => row.distanceMetres <= nearbyRadiusMetres);
		return rulesetRunnerReturning(matches, nearby)(site, ruleset, nearbyRadiusMetres);
	};
}
