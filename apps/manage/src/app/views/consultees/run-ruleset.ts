import type { ManageService } from '#service';
import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import { getCaseBoundaryDisplayGeometries } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import {
	bufferGeometryForDisplay,
	getConsulteeAreaDisplayGeometries
} from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import type {
	ConsulteeMatch,
	Ruleset,
	RunRulesetResult,
	SiteScreenedAs
} from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { getRuleset, RULESETS } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { SearchAreaDisplay } from '../../maps/case-geojson.ts';
import { findNearbyNsips, isNearbyNsip } from './nearby-nsips.ts';
import { activeTestFault } from './test-faults.ts';

/**
 * Shared plumbing for the consultee pages that run a ruleset (the project map page and the
 * results/report page): normalising the ?ruleset query param, running the ruleset without
 * letting a failure take the whole page down, and building the map's search area.
 */

/**
 * The ruleset a report page's `?ruleset=` names - the default when it names none, and undefined
 * (the page 404s) for one that isn't known.
 */
export function requestedRuleset(value: unknown): Ruleset | undefined {
	const id = firstQueryValue(value);
	return id ? getRuleset(id) : RULESETS[0];
}

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
	/** What was screened: the site's outline, or - for one too detailed to screen in time - its bounding box. */
	siteScreenedAs: SiteScreenedAs;
}

/** The session field holding the last ruleset run - see runRulesetSafely. */
// versioned: a run kept from before Nearby NSIPs were called NSIPs is run again, not read
export const RULESET_RUN_SESSION_FIELD = 'rulesetRun2';

// long enough for a report journey; short enough that reference data reloaded since is picked up
export const RULESET_RUN_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * A ruleset run as the session keeps it: who it was for, when, and its matches without geometry.
 * The list (a consultee per identified match, with name and reasons) is the biggest payload the
 * session holds - Redis in deployed environments. Worth watching as the reference data grows; if
 * it ever dominates Redis memory, keep a compact run reference and re-derive the list instead.
 */
export interface StoredRulesetRun {
	caseId: string;
	rulesetId: string;
	ranAt: number;
	consultees: ConsulteeMatch[];
	/** Absent from a run kept before boxes were used - the outline, then. */
	siteScreenedAs?: SiteScreenedAs;
}

/** Where a run is kept between requests: the request's session, if it has one. */
export type RulesetRunStore = Record<string, unknown> | undefined;

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

/** What a ruleset run needs from the service. No Nearby NSIPs distance means none are looked for. */
export type RulesetRunService = Pick<ManageService, 'db' | 'logger' | 'rulesetRunner' | 'nearbyConsulteeRadiusMetres'> &
	Partial<Pick<ManageService, 'nearbyNsipRadiusMetres' | 'testFaultsEnabled'>>;

/**
 * Run the ruleset in the Python function (see ruleset-runner.ts), and add the Nearby NSIPs - other
 * cases near the site, from case_boundary (see nearby-nsips.ts) - so every page treats them as
 * another consultee category. If either fails - the function is down, slow or errors, say - the
 * page says the ruleset couldn't be run - there's no in-app fallback, so there's one implementation
 * of the intersection logic rather than two that could quietly disagree. Nor is a failed run tried
 * again on the site's bounding box: the function decides that up front, and a retry would only add
 * a second run's queries to a database already struggling with the first's.
 *
 * Given the session, the run is kept there - only the last one, for an hour - so the report pages,
 * their maps and the download use one run rather than each running the ruleset again. Nothing is
 * kept beyond the session. A kept run has no geometry, so a page using one draws its map from
 * display geometry alone (as it does whenever the search area can be built).
 */
export async function runRulesetSafely(
	service: RulesetRunService,
	project: CaseBoundaryFeature,
	ruleset: Ruleset,
	store?: RulesetRunStore
): Promise<RulesetRun> {
	// the QA fault trigger (test-faults.ts) wins over a kept run: an outage hits whatever the
	// session holds - and a forced failure is never kept, so clearing it runs the ruleset again
	if (activeTestFault(service, store) === 'ruleset') {
		service.logger.error({ caseId: project.id, rulesetId: ruleset.id }, 'test-fail=ruleset: forced ruleset failure');
		return { consultees: [], failed: true, siteScreenedAs: 'outline' };
	}
	const stored = storedRun(store, project, ruleset);
	if (stored) {
		return { consultees: stored.consultees, failed: false, siteScreenedAs: stored.siteScreenedAs ?? 'outline' };
	}
	try {
		const [run, nearbyNsips] = await Promise.all([
			service.rulesetRunner(screenedGeometry(project), ruleset, service.nearbyConsulteeRadiusMetres),
			findNearbyNsips(service.db, project, service.nearbyNsipRadiusMetres ?? 0)
		]);
		const consultees = [...run.consultees, ...nearbyNsips];
		const siteScreenedAs = run.siteScreenedAs ?? 'outline';
		if (store) {
			const run: StoredRulesetRun = {
				caseId: project.id,
				rulesetId: ruleset.id,
				ranAt: Date.now(),
				// no geometry to drop: the function sends none, and Nearby NSIPs have none - the maps
				// draw from display geometry (see buildSearchAreaSafely)
				consultees,
				siteScreenedAs
			};
			store[RULESET_RUN_SESSION_FIELD] = run;
		}
		return { consultees, failed: false, siteScreenedAs };
	} catch (error) {
		service.logger.error({ error, caseId: project.id, rulesetId: ruleset.id }, 'Failed to run ruleset');
		return { consultees: [], failed: true, siteScreenedAs: 'outline' };
	}
}

/**
 * The site's boundary as stored simplified, where it was read (see getCaseBoundaryById), else as
 * drawn: what's sent to be screened, and grown into the map's search area. The function simplifies
 * the site the same way, so it finds the same consultees either way - but a detailed boundary is a
 * fraction of the size simplified (111,931 points to 4,817), and past config/screening.yaml's limit
 * either way, the function screens its bounding box without simplifying it at all.
 */
function screenedGeometry(project: CaseBoundaryFeature) {
	return project.simplifiedGeometry ?? project.geometry;
}

/**
 * The interactive map's search area - the site grown by the nearby radius - and the display
 * geometry of every consultee touching it: consultee areas', and Nearby NSIPs' boundaries. The map
 * is an extra: if this fails, the page still lists every consultee in its tables.
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
		const area = await bufferGeometryForDisplay(db, screenedGeometry(project), nearbyRadiusMetres);
		const ids = (nearbyNsips: boolean) => [
			...new Set(matches.filter((match) => isNearbyNsip(match) === nearbyNsips).map((match) => match.feature.id))
		];
		const [consulteeAreas, caseBoundaries] = await Promise.all([
			getConsulteeAreaDisplayGeometries(db, ids(false), area),
			getCaseBoundaryDisplayGeometries(db, ids(true), area)
		]);
		return { area, geometries: new Map([...consulteeAreas, ...caseBoundaries]) };
	} catch (error) {
		logger.error({ error, caseId: project.id }, 'Failed to build the map search area');
		return undefined;
	}
}
