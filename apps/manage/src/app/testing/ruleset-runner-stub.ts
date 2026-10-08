import type { PrismaClient } from '@pins/identify-consultees-database/src/client/client.ts';
import type { ConsulteeReason } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
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
	/** Absent for a consultee only the nearby search found - the function sends those without it. */
	geometryWkt?: string;
	distanceMetres: number;
	/** Defaults to one condition reason, `test-condition`. */
	reasons?: ConsulteeReason[];
}

const DEFAULT_REASONS: ConsulteeReason[] = [{ type: 'condition', conditionId: 'test-condition' }];

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
		...(row.geometryWkt ? { geometryWkt: row.geometryWkt } : {})
	};
}

/**
 * Stands in for the Python function: resolves with `rows` as its consultees (each with its own
 * `reasons`, or one condition reason by default), passed through the real response mapping.
 */
export function rulesetRunnerReturning(rows: ConsulteeAreaMatchRow[]): RulesetRunner & ReturnType<typeof mock.fn> {
	return mock.fn<RulesetRunner>(async () =>
		toRunRulesetResult({
			consultees: rows.map((row) => ({
				feature: feature(row),
				distanceMetres: row.distanceMetres,
				reasons: row.reasons ?? DEFAULT_REASONS
			}))
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
 * tests: the app's pages need real-looking consultees from the seeded data to click through, but CI
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
		const consultees = rows.flatMap((row) => {
			const reasons: ConsulteeReason[] = rules
				.filter(
					(rule) =>
						rule.categories.includes(row.consulteeCategory ?? '') && row.distanceMetres <= (rule.bufferMetres ?? 0)
				)
				.map((rule) => ({ type: 'condition', conditionId: rule.id }));
			if (row.distanceMetres <= nearbyRadiusMetres) {
				reasons.push({ type: 'nearby', radiusMetres: nearbyRadiusMetres });
			}
			return reasons.length > 0 ? [{ ...row, reasons }] : [];
		});
		return rulesetRunnerReturning(consultees)(site, ruleset, nearbyRadiusMetres);
	};
}
