import type { ManageService } from '#service';
import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import {
	bufferGeometryForDisplay,
	getConsulteeAreaDisplayGeometries
} from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import type {
	ConsulteeMatch,
	Ruleset,
	RunRulesetResult
} from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { SearchAreaDisplay } from '../../maps/case-geojson.ts';
import type { RulesetRunner } from '../../ruleset-runner.ts';

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

/** The session field holding the last ruleset run - see runRulesetSafely. */
export const RULESET_RUN_SESSION_FIELD = 'rulesetRun';

// long enough for a report journey; short enough that reference data reloaded since is picked up
export const RULESET_RUN_MAX_AGE_MS = 60 * 60 * 1000;

/** A ruleset run as the session keeps it: who it was for, when, and its matches without geometry. */
export interface StoredRulesetRun {
	caseId: string;
	rulesetId: string;
	ranAt: number;
	consultees: ConsulteeMatch[];
}

/** Where a run is kept between requests: the request's session, if it has one. */
export type RulesetRunStore = Record<string, unknown> | undefined;

/**
 * A match as the session keeps it: no geometry (the full run is tens of MB of it - the maps draw
 * from display geometry instead, see buildSearchAreaSafely) and no metadata (the report export
 * reads each consultee's stored row).
 */
function withoutGeometry(match: ConsulteeMatch): ConsulteeMatch {
	const properties = { ...match.feature.properties };
	delete properties.metadata;
	return {
		distanceMetres: match.distanceMetres,
		reasons: match.reasons,
		feature: { id: match.feature.id, properties }
	};
}

function storedRun(
	store: RulesetRunStore,
	project: CaseBoundaryFeature,
	ruleset: Ruleset
): StoredRulesetRun | undefined {
	const run = store?.[RULESET_RUN_SESSION_FIELD] as StoredRulesetRun | undefined;
	if (run?.caseId === project.id && run.rulesetId === ruleset.id && Date.now() - run.ranAt < RULESET_RUN_MAX_AGE_MS) {
		return run;
	}
	return undefined;
}

/**
 * Run the ruleset in the Python function (see ruleset-runner.ts). If it's down, slow or errors, the
 * page says the ruleset couldn't be run - there's no in-app fallback, so there's one implementation
 * of the intersection logic rather than two that could quietly disagree.
 *
 * Given the session, the run is kept there - only the last one, for an hour - so the report pages,
 * their maps and the download use one run rather than each running the ruleset again. Nothing is
 * kept beyond the session. A kept run has no geometry, so a page using one draws its map from
 * display geometry alone (as it does whenever the search area can be built).
 */
export async function runRulesetSafely(
	runRuleset: RulesetRunner,
	project: CaseBoundaryFeature,
	ruleset: Ruleset,
	nearbyRadiusMetres: number,
	logger: ManageService['logger'],
	store?: RulesetRunStore
): Promise<RulesetRun> {
	const stored = storedRun(store, project, ruleset);
	if (stored) {
		return { consultees: stored.consultees, failed: false };
	}
	try {
		const { consultees } = await runRuleset(project.geometry, ruleset, nearbyRadiusMetres);
		if (store) {
			const run: StoredRulesetRun = {
				caseId: project.id,
				rulesetId: ruleset.id,
				ranAt: Date.now(),
				consultees: consultees.map(withoutGeometry)
			};
			store[RULESET_RUN_SESSION_FIELD] = run;
		}
		return { consultees, failed: false };
	} catch (error) {
		logger.error({ error, caseId: project.id, rulesetId: ruleset.id }, 'Failed to run ruleset');
		return { consultees: [], failed: true };
	}
}

/**
 * The interactive map's search area - the site grown by the nearby radius - and the display
 * geometry of every consultee touching it. The map is an extra: if this fails, the page still lists every consultee
 * in its tables.
 */
export async function buildSearchAreaSafely(
	db: ManageService['db'],
	project: CaseBoundaryFeature,
	matches: ConsulteeMatch[],
	nearbyRadiusMetres: number,
	logger: ManageService['logger']
): Promise<SearchAreaDisplay | undefined> {
	if (matches.length === 0) {
		return undefined;
	}
	try {
		const area = await bufferGeometryForDisplay(db, project.geometry, nearbyRadiusMetres);
		const ids = [...new Set(matches.map((match) => match.feature.id))];
		return { area, geometries: await getConsulteeAreaDisplayGeometries(db, ids, area) };
	} catch (error) {
		logger.error({ error, caseId: project.id }, 'Failed to build the map search area');
		return undefined;
	}
}
