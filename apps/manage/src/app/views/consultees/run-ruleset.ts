import type { ManageService } from '#service';
import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import { getCaseBoundaryDisplayGeometries } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import { getConsulteeAreaDisplayGeometries } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import type {
	ConsulteeMatch,
	Ruleset,
	RunRulesetResult,
	SiteScreenedAs
} from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { getRuleset, isIdentified, RULESETS } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { Geometry } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';
import type { MapMatch, SearchAreaDisplay } from '../../maps/case-geojson.ts';
import { grownSite } from './grown-site.ts';
import { findNearbyNsips, isNearbyNsip } from './nearby-nsips.ts';

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

/** A ruleset run as the session keeps it: who it was for, when, and its matches without geometry. */
export interface StoredRulesetRun {
	caseId: string;
	rulesetId: string;
	ranAt: number;
	consultees: ConsulteeMatch[];
	/** Absent from a run kept before boxes were used - the outline, then. */
	siteScreenedAs?: SiteScreenedAs;
}

/** The session field's pointer to a run kept in Redis: enough to name it, none of its consultees. */
export interface StoredRunReference {
	caseId: string;
	rulesetId: string;
	ranAt: number;
}

/** Where a run is kept between requests: the request's session, if it has one. */
export type RulesetRunStore = Record<string, unknown> | undefined;

/**
 * The Redis key a session's run is kept under. A run's consultees - hundreds, each with its
 * reasons - are most of a session record's size, and the record is read and parsed on every
 * request, each tile of a map's pan included. Given Redis and a session id, the consultees are
 * kept here instead and only read by the pages that need them; the session field holds just the
 * pointer. Sessions without Redis or an id (a test's plain store) keep the run as they did.
 * The key takes the app's prefix - `manage:rulesetRun:` - so it sits alongside this app's
 * `manage:sess:` session records in a shared Redis rather than at the root.
 */
function runKey(service: RulesetRunService, store: RulesetRunStore): string | undefined {
	return typeof store?.id === 'string' ? `${service.redisPrefix}rulesetRun:${store.id}` : undefined;
}

async function storedRun(
	service: RulesetRunService,
	store: RulesetRunStore,
	project: CaseBoundaryFeature,
	ruleset: Ruleset
): Promise<StoredRulesetRun | undefined> {
	const kept = store?.[RULESET_RUN_SESSION_FIELD] as StoredRulesetRun | StoredRunReference | undefined;
	const fresh =
		kept?.caseId === project.id && kept.rulesetId === ruleset.id && Date.now() - kept.ranAt < RULESET_RUN_MAX_AGE_MS;
	if (!kept || !fresh) {
		return undefined;
	}
	// a session keeping the run itself - no Redis, or an id-less store - gives it as stored
	if ('consultees' in kept) {
		return kept;
	}
	const key = runKey(service, store);
	if (!key || !service.redisClient) {
		return undefined;
	}
	try {
		// through fullClient, like the write: core copies the client's get/set unbound onto the
		// wrapper, and calling one there throws against a real cluster
		const raw = await service.redisClient.fullClient.get(key);
		const run = raw ? (JSON.parse(raw) as StoredRulesetRun) : undefined;
		// the key is only trusted as the session's run if it's the run the pointer names - a key a
		// session left behind when its id was reissued is no one's to read
		if (run?.caseId === kept.caseId && run.rulesetId === kept.rulesetId && run.ranAt === kept.ranAt) {
			return run;
		}
	} catch (error) {
		service.logger.warn({ error }, "Failed to read the session's ruleset run from Redis");
	}
	return undefined;
}

/**
 * The pointer the session field holds for this case and ruleset's last run, if it's still fresh -
 * whether the field is a pointer into Redis or a whole kept run (both name it the same way).
 * Reads neither geometry nor Redis, so a page can name the remembered run - a `ranAt` - before
 * paying for either; runRulesetSafely's storedRun resolves it when the run itself is needed.
 */
export function storedRunReference(
	store: RulesetRunStore,
	caseId: string,
	rulesetId: string
): StoredRunReference | undefined {
	const kept = store?.[RULESET_RUN_SESSION_FIELD] as StoredRulesetRun | StoredRunReference | undefined;
	if (kept?.caseId === caseId && kept.rulesetId === rulesetId && Date.now() - kept.ranAt < RULESET_RUN_MAX_AGE_MS) {
		return { caseId: kept.caseId, rulesetId: kept.rulesetId, ranAt: kept.ranAt };
	}
	return undefined;
}

/** What a ruleset run needs from the service. No Nearby NSIPs distance means none are looked for. */
export type RulesetRunService = Pick<
	ManageService,
	'db' | 'logger' | 'rulesetRunner' | 'nearbyConsulteeRadiusMetres' | 'redisClient' | 'redisPrefix'
> &
	Partial<Pick<ManageService, 'nearbyNsipRadiusMetres'>>;

/**
 * Run the ruleset in the Python function (see ruleset-runner.ts), and add the Nearby NSIPs - other
 * cases near the site, from case_boundary (see nearby-nsips.ts) - so every page treats them as
 * another consultee category. If either fails - the function is down, slow or errors, say - the
 * page says the ruleset couldn't be run - there's no in-app fallback, so there's one implementation
 * of the intersection logic rather than two that could quietly disagree. Nor is a failed run tried
 * again on the site's bounding box: the function decides that up front, and a retry would only add
 * a second run's queries to a database already struggling with the first's.
 *
 * Given the session, the run is kept for it - only the last one, for an hour - so the report
 * pages, their maps and the download use one run rather than each running the ruleset again.
 * Where the session has an id and the service has Redis, the run's consultees are kept under the
 * session's own Redis key and the session field holds only the pointer to it: the run is most of
 * a session record's size, and every request - the tiles of a map's pan too - reads and parses
 * the record. Otherwise the whole run is kept in the session, as before. Nothing is kept beyond
 * the session and its key. A kept run has no geometry, so a page using one draws its map from
 * display geometry alone (as it does whenever the search area can be built).
 */
export async function runRulesetSafely(
	service: RulesetRunService,
	project: CaseBoundaryFeature,
	ruleset: Ruleset,
	store?: RulesetRunStore
): Promise<RulesetRun> {
	const stored = await storedRun(service, store, project, ruleset);
	if (stored) {
		return { consultees: stored.consultees, failed: false, siteScreenedAs: stored.siteScreenedAs ?? 'outline' };
	}
	try {
		const [run, nearbyNsips] = await Promise.all([
			// the case boundary's id, so the function can check the administrative areas it finds
			// against the site's actual boundary rather than the simplified one screened
			service.rulesetRunner(screenedGeometry(project), ruleset, service.nearbyConsulteeRadiusMetres, project.id),
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
			const key = runKey(service, store);
			if (key && service.redisClient) {
				try {
					// the key outlives the session field by design: it names the run it holds, so a key a
					// reissued session left behind is never mistaken for that session's own
					await service.redisClient.fullClient.setEx(
						key,
						Math.ceil(RULESET_RUN_MAX_AGE_MS / 1000),
						JSON.stringify(run)
					);
					store[RULESET_RUN_SESSION_FIELD] = {
						caseId: run.caseId,
						rulesetId: run.rulesetId,
						ranAt: run.ranAt
					} satisfies StoredRunReference;
				} catch (error) {
					service.logger.warn({ error }, 'Failed to keep the ruleset run in Redis - keeping it in the session');
					store[RULESET_RUN_SESSION_FIELD] = run;
				}
			} else {
				store[RULESET_RUN_SESSION_FIELD] = run;
			}
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
 * either way, the function screens its bounding box without simplifying it at all. The add page
 * measures its suggestions' distances from it too: from the detailed boundary, a search for a
 * name timed out.
 */
export function screenedGeometry(project: CaseBoundaryFeature) {
	return project.simplifiedGeometry ?? project.geometry;
}

/** Search areas already grown, by radius - so the maps of one report grow the site only once. */
export type SearchAreaCache = Map<number, Promise<Geometry>>;

/**
 * The interactive map's search area - the site grown by the nearby radius - and the display
 * geometry of the consultees to draw: consultee areas', and Nearby NSIPs' boundaries. A consultee
 * the run identified, or one added by hand, is drawn wherever it is: a district bordering the host
 * authority can lie further from the site than the search reaches (Torridge, from a site in mid
 * Cornwall), and one added by hand may be one the run never found (see addedBeyondRun). Only the
 * nearby consultees drawn as context are limited to the search area. The map is an extra: if this
 * fails, the page still lists every consultee in its tables. A report's maps share `cache`:
 * growing a large site by 35km takes seconds, and a report has a map for each of its categories.
 */
export async function buildSearchAreaSafely(
	db: ManageService['db'],
	project: CaseBoundaryFeature,
	matches: MapMatch[],
	nearbyRadiusMetres: number,
	logger: ManageService['logger'],
	cache: SearchAreaCache = new Map()
): Promise<SearchAreaDisplay | undefined> {
	if (matches.length === 0) {
		return undefined;
	}
	try {
		let grown = cache.get(nearbyRadiusMetres);
		if (!grown) {
			grown = grownSite(db, screenedGeometry(project), nearbyRadiusMetres);
			cache.set(nearbyRadiusMetres, grown);
		}
		const area = await grown;
		// only the nearby consultees drawn as context are limited to the search area
		const asContext = (match: MapMatch) => match.addedByHand !== true && !isIdentified(match);
		const ids = (nearbyNsips: boolean, context: boolean) => [
			...new Set(
				matches
					.filter((match) => isNearbyNsip(match) === nearbyNsips && asContext(match) === context)
					.map((match) => match.feature.id)
			)
		];
		const found = await Promise.all([
			getConsulteeAreaDisplayGeometries(db, ids(false, true), area),
			getCaseBoundaryDisplayGeometries(db, ids(true, true), area),
			getConsulteeAreaDisplayGeometries(db, ids(false, false)),
			getCaseBoundaryDisplayGeometries(db, ids(true, false))
		]);
		return { area, geometries: new Map(found.flatMap((geometries) => [...geometries])) };
	} catch (error) {
		logger.error({ error, caseId: project.id }, 'Failed to build the map search area');
		return undefined;
	}
}
