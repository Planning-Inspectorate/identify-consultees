import type { ManageService } from '#service';
import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import { getCaseBoundaryById } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Look up a case by id. case_boundary ids are UNIQUEIDENTIFIERs - anything else can't match, and
 * isn't worth a round trip (or a raw-SQL CAST error) to find out.
 */
export async function resolveCase(db: ManageService['db'], caseId: string): Promise<CaseBoundaryFeature | undefined> {
	if (!UUID_PATTERN.test(caseId)) {
		return undefined;
	}
	const project = await getCaseBoundaryById(db, caseId);
	return project ?? undefined;
}
