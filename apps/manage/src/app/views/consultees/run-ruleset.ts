import type { ManageService } from '#service';
import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type {
	ConsulteeAreaMatch,
	ConsulteeAreaSummaryMatch
} from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import {
	bufferGeometryForDisplay,
	getConsulteeAreaDisplayGeometries
} from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import type { Ruleset, RunRulesetResult } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { getRuleset, RULESETS, runRuleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { SearchAreaDisplay } from '../../maps/case-geojson.ts';

/**
 * Shared plumbing for the consultee pages that run a ruleset (the project map page and the
 * results/report page): normalising the ?ruleset query param, running the ruleset without
 * letting a failure take the whole page down, and building the map's search area.
 */

/** First string from a possibly-repeated query/body param (`?a=1&a=2` parses to an array). */
export function firstQueryValue(value: unknown): string {
	if (Array.isArray(value)) {
		return typeof value[0] === 'string' ? value[0] : '';
	}
	return typeof value === 'string' ? value : '';
}

interface RulesetRun extends RunRulesetResult {
	// distinguishes "ran and matched nothing" from "couldn't run" - both have empty results
	failed: boolean;
}

export async function runRulesetSafely(
	db: ManageService['db'],
	project: CaseBoundaryFeature,
	ruleset: Ruleset,
	nearbyRadiusMetres: number,
	logger: ManageService['logger']
): Promise<RulesetRun> {
	try {
		return { ...(await runRuleset(db, project.geometry, ruleset, nearbyRadiusMetres)), failed: false };
	} catch (error) {
		logger.error({ error, caseId: project.id, rulesetId: ruleset.id }, 'Failed to run ruleset');
		return { matches: [], allNearby: [], failed: true };
	}
}

/**
 * The interactive map's search area - the site grown by the nearby radius - with every nearby
 * consultee and ruleset match clipped to it. The map is an extra: if this fails, the page still
 * lists every consultee in its tables.
 */
export async function buildSearchAreaSafely(
	db: ManageService['db'],
	project: CaseBoundaryFeature,
	matches: ConsulteeAreaMatch[],
	nearby: ConsulteeAreaSummaryMatch[],
	nearbyRadiusMetres: number,
	logger: ManageService['logger']
): Promise<SearchAreaDisplay | undefined> {
	if (nearby.length === 0 && matches.length === 0) {
		return undefined;
	}
	try {
		const area = await bufferGeometryForDisplay(db, project.geometry, nearbyRadiusMetres);
		const ids = [...new Set([...nearby, ...matches].map((match) => match.feature.id))];
		const radiusKm = nearbyRadiusMetres / 1000;
		return {
			area,
			nearbyLabel: `All consultees within ${radiusKm}km`,
			nearby,
			geometries: await getConsulteeAreaDisplayGeometries(db, ids, area)
		};
	} catch (error) {
		logger.error({ error, caseId: project.id }, 'Failed to build the map search area');
		return undefined;
	}
}

/**
 * The ruleset a picker page should treat as current: the requested one if it's real, else the
 * first (top-of-list) ruleset - pickers pre-select rather than error, since they only carry the
 * map page's state.
 */
export function selectedRuleset(requestedId: unknown): Ruleset {
	return getRuleset(firstQueryValue(requestedId)) ?? RULESETS[0];
}

/** The project map page for a boundary/ruleset pair - where the pickers' "Save and return" leads. */
export function projectPageUrl(caseId: string, rulesetId: string): string {
	return `/consultees/${encodeURIComponent(caseId)}?ruleset=${encodeURIComponent(rulesetId)}`;
}
