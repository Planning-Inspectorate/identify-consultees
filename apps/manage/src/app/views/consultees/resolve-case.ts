import type { ManageService } from '#service';
import type {
	CaseBoundaryFeature,
	CaseBoundarySummary
} from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import {
	getCaseBoundaryById,
	getCaseBoundarySummaryById
} from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isCaseId(caseId: string): boolean {
	// case_boundary ids are UNIQUEIDENTIFIERs - anything else can't match, and isn't worth a round
	// trip (or a raw-SQL CAST error) to find out
	return UUID_PATTERN.test(caseId);
}

/**
 * Look up a case by id, with its geometry - for the results page, which needs it to run a
 * ruleset. Prefer {@link resolveCaseSummary} for anything that only displays reference/name/date.
 */
export async function resolveCase(db: ManageService['db'], caseId: string): Promise<CaseBoundaryFeature | undefined> {
	if (!isCaseId(caseId)) {
		return undefined;
	}
	const project = await getCaseBoundaryById(db, caseId);
	return project ?? undefined;
}

/**
 * Look up a case by id, without its geometry - see {@link CaseBoundarySummary}. Use this instead
 * of {@link resolveCase} wherever the page doesn't render or query against the boundary's shape
 * (e.g. the ruleset picker page, which only shows the case's name and reference).
 */
export async function resolveCaseSummary(
	db: ManageService['db'],
	caseId: string
): Promise<CaseBoundarySummary | undefined> {
	if (!isCaseId(caseId)) {
		return undefined;
	}
	const project = await getCaseBoundarySummaryById(db, caseId);
	return project ?? undefined;
}
