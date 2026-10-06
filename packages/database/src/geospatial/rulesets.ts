import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '../client/client.ts';
import type { ConsulteeAreaMatch, ConsulteeAreaSummaryMatch } from './consultee-areas.ts';
import {
	findConsulteeAreaSummariesNear,
	findConsulteeAreasBordering,
	findConsulteeAreasNear,
	getConsulteeAreaGeometries
} from './consultee-areas.ts';
import { DEFAULT_NEARBY_RADIUS_METRES } from './nearby-radius.ts';
import type { Geometry } from './wkt.ts';

/**
 * One condition within a ruleset (one row of the ruleset export - see RULESET_CSV_PATH below).
 * A ruleset is made up of many of these; running the ruleset means running every one of its
 * conditions and combining the results (see runRuleset) - a single condition on its own (e.g.
 * "district council hosting the site") routinely matches nothing for a *specific* project (e.g.
 * one that sits in a unitary-authority area, which has no district council at all) without that
 * being a bug - it's only the combined result across every condition that means anything.
 *
 * Each condition is one of two shapes:
 * - `intersection`: match consultee areas of `categories` within `bufferMetres` of the site
 *   (0 = must actually intersect, not just be nearby).
 * - `bordering`: find the `hostCategory` area that intersects the site (e.g. the parish the site
 *   sits in), then match consultee areas of `categories` that share a border with that host area
 *   (e.g. neighbouring parishes) - a different query shape to `intersection`, not just a distance
 *   check, so it isn't expressible as a radius.
 */
export type RuleLogicType = 'intersection' | 'bordering';

export interface RuleCondition {
	id: string;
	name: string;
	logicType: RuleLogicType;
	/** consultee_area.consulteeCategory values this condition matches (OR'd together). */
	categories: string[];
	/** intersection only: buffer radius in metres (0 = must actually intersect). */
	bufferMetres?: number;
	/** bordering only: the category of the area that must intersect the site first. */
	hostCategory?: string;
}

/**
 * A named ruleset: the full set of conditions to run against a project to find every consultee it
 * needs to notify. Only one exists so far (loaded whole from the example export below) - the real
 * set (around 8, each presumably its own export in the same shape) will replace/extend this list
 * later; nothing about running a ruleset needs to change when they arrive.
 */
export interface Ruleset {
	id: string;
	name: string;
	rules: RuleCondition[];
}

// The ruleset export uses short internal identifiers (e.g. "parish", "rail_epsg27700") where the
// loaded reference data uses human-readable category names (e.g. "Parish Council", "Railway") -
// this bridges the two. A handful of export identifiers (canals, MoD safeguarding/low-flying
// areas, coal mining reporting areas, Cheshire brine area, Joint Transport Authorities Wales)
// have no current mapping because that reference data hasn't been loaded yet - left as-is below,
// which just means that condition matches nothing until it is, rather than guessing wrong.
// a Map, not an object literal - these keys are snake_case source identifiers, not JS property
// names, and an object literal's keys get flagged (rightly) by the camelcase lint rule
// Categories excluded from the unconstrained "any category" nearby fetch (see runRuleset's
// allNearby) regardless of distance, because their reference data isn't fit for a radius query:
// Railway's rows are merged nationwide by type/status rather than split by region (one feature -
// "Freight And Passenger - Main Line - Active" - is a single MultiLineString covering the whole GB
// network, ~116k parts), so a) its bounding box covers the entire country, meaning the spatial
// index can't rule it out for *any* location, forcing the full, expensive exact-distance
// computation against that geometry on every single call (confirmed locally: roughly doubles this
// query's cost - see consultee-areas.ts findConsulteeAreasNear), and b) even once computed, "within
// any sensible radius of the merged national network" is true for almost every project in Great
// Britain, so the result carries no real information anyway. Already excluded from every ruleset
// condition for the same reason (see example_ruleset.csv) - this is the matching exclusion for the
// one query that has no per-condition category filter to exclude it via otherwise.
const CATEGORIES_EXCLUDED_FROM_NEARBY = ['Railway'];

const CATEGORY_ALIASES = new Map<string, string[]>([
	['parish', ['Parish Council']],
	['distr_council', ['Lower Tier Authority']],
	['unitary_auth', ['Unitary Authority']],
	['unit_auth', ['Unitary Authority']],
	['nat_park', ['National Park']],
	['county_council', ['Upper Tier Authority']],
	['greater_london_authority', ['Greater London Authority']],
	['rail_epsg27700', ['Railway']],
	['ambulance_services_epsg27700', ['Ambulance Trust']],
	['fire_and_rescue_service', ['Fire and Rescue Authority']],
	[
		'passenger_transport_exec_integrated_transport_auth',
		['Passenger Transport Executive', 'Integrated Transport Authority']
	],
	['police_crime_commissioner', ['Police']],
	['hospital', ['Hospital']],
	['integrated_care_board', ['ICB']],
	['idd_w_epsg27700', ['Internal Drainage District']],
	['internal_drainage_board_england', ['Internal Drainage Board']],
	['local_resilience_forum', ['Local Resilience Forum']],
	['local_health_board', ['Local Health Board']],
	['national_landscape_aonb_england', ['National Landscape']],
	['national_landscape_aonb_wales', ['National Landscape']],
	['ports_harbours_epsg27700', ['Dock or Harbour']],
	['offshore_areas_wind_site', ['Offshore Wind Site']],
	['offshore_areas_export_cable', ['Offshore Wind Export Cable']],
	['office_for_nuclear_regulation_site', ['ONR Site']]
]);

function resolveCategories(token: string): string[] {
	const trimmed = token.trim();
	return CATEGORY_ALIASES.get(trimmed) ?? [trimmed];
}

/** A row's matching categories: referenceData if set, else matchingConsulteeType (`;`-separated), else consulteeName. */
function matchingCategoriesFor(row: {
	consulteeName: string;
	referenceData: string;
	matchingConsulteeType: string;
}): string[] {
	if (row.referenceData) {
		return resolveCategories(row.referenceData);
	}
	if (row.matchingConsulteeType) {
		return row.matchingConsulteeType.split(';').flatMap(resolveCategories);
	}
	return resolveCategories(row.consulteeName);
}

const RULESET_CSV_COLUMNS = [
	'consulteeName',
	'referenceData',
	'consulteeDescription',
	'matchingConsulteeType',
	'hostType',
	'logicDescription',
	'logicType',
	'intersectionBufferKm'
] as const;

/**
 * Parse the tab-separated ruleset export into RuleConditions (one ruleset's worth of rows - see
 * buildRulesetFromCsv). Not a general CSV parser - fields here are never quoted/escaped, so a
 * plain split on tabs and newlines is enough.
 */
export function parseRulesetCsv(contents: string): RuleCondition[] {
	const lines = contents.split('\n').filter((line) => line.trim() !== '');
	const [header, ...dataLines] = lines;
	const columns = header.split('\t').map((column) => column.trim());
	for (const expected of RULESET_CSV_COLUMNS) {
		if (!columns.includes(expected)) {
			throw new Error(`Ruleset CSV is missing expected column "${expected}"`);
		}
	}

	return dataLines.map((line) => {
		const cells = line.split('\t');
		const row = Object.fromEntries(columns.map((column, index) => [column, (cells[index] ?? '').trim()])) as Record<
			(typeof RULESET_CSV_COLUMNS)[number],
			string
		>;

		const logicType: RuleLogicType = row.logicType === 'bordering' ? 'bordering' : 'intersection';
		const categories = matchingCategoriesFor(row);

		if (logicType === 'bordering') {
			return {
				id: row.consulteeName,
				name: row.consulteeDescription,
				logicType,
				categories,
				hostCategory: row.hostType ? resolveCategories(row.hostType)[0] : undefined
			};
		}

		return {
			id: row.consulteeName,
			name: row.consulteeDescription,
			logicType,
			categories,
			bufferMetres: (Number.parseFloat(row.intersectionBufferKm) || 0) * 1000
		};
	});
}

/** Build one named Ruleset from a whole CSV export - every row becomes one of its conditions. */
export function buildRulesetFromCsv(id: string, name: string, contents: string): Ruleset {
	return { id, name, rules: parseRulesetCsv(contents) };
}

// co-located with this module (not under apps/function-python/setup_database/sample_data, where
// it originally lived) so it's guaranteed to exist wherever packages/database is deployed - a
// cross-app relative path here previously crashed the manage app's Docker image at startup, since
// that image only ever copies packages/ and apps/manage/, never apps/function-python
const RULESET_CSV_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'example_ruleset.csv');

// Only one ruleset exists yet, built from the one real export provided so far. The real set
// (around 8) will replace this list later - each presumably its own named CSV export loaded the
// same way, not a change to how a ruleset is run.
export const RULESETS: Ruleset[] = [
	buildRulesetFromCsv('example-ruleset', 'Example ruleset', readFileSync(RULESET_CSV_PATH, 'utf8'))
];

export function getRuleset(id: string): Ruleset | undefined {
	return RULESETS.find((ruleset) => ruleset.id === id);
}

// re-exported for callers/tests that reason about ruleset condition execution - the retry itself
// now lives in consultee-areas.ts, since any read against consultee_area can be a deadlock victim
// under concurrent load, not just one made from within a ruleset run (see there for why)
export { isDeadlockError, withDeadlockRetry } from './consultee-areas.ts';

async function runCondition(
	dbClient: PrismaClient,
	geometry: Geometry,
	rule: RuleCondition
): Promise<ConsulteeAreaMatch[]> {
	if (rule.logicType === 'bordering') {
		if (!rule.hostCategory) {
			return [];
		}
		return findConsulteeAreasBordering(dbClient, geometry, rule.hostCategory, rule.categories);
	}
	return findConsulteeAreasNear(dbClient, geometry, rule.bufferMetres ?? 0, rule.categories);
}

// Conditions that can't be satisfied from the shared "nearby" fetch below (see runRuleset) run
// concurrently in batches of this size, not all at once. Running every condition fully in parallel
// maximises throughput for a single ruleset run in isolation, but multiplies how many simultaneous
// connections/locks it holds against the same table - confirmed to matter for real, not just in
// theory: running everything fully parallel produced real deadlocks and request timeouts once
// other work was hitting the same table concurrently. A bounded batch size keeps most of the
// speed-up over a fully sequential run while giving the database far less simultaneous load to
// contend with.
const CONDITION_CONCURRENCY = 6;

// re-exported for callers that want the default radius without importing this module (and so
// pulling in the generated Prisma client - see nearby-radius.ts's own doc comment for why that
// matters to apps/manage's build step)
export { DEFAULT_NEARBY_RADIUS_METRES } from './nearby-radius.ts';

/**
 * True when `rule` can be answered by filtering the shared nearby fetch instead of its own query.
 * False for any rule touching a category excluded from that fetch (or matching every category,
 * `categories.length === 0`, which includes an excluded one implicitly) - the shared fetch simply
 * doesn't have those rows to filter, so a rule like that must run its own query instead (still
 * fast: unlike the shared "any category" fetch, a real rule's own query is always category-scoped,
 * so it never pays CATEGORIES_EXCLUDED_FROM_NEARBY's cost in the first place).
 */
function isSatisfiableFromNearby(rule: RuleCondition, nearbyRadiusMetres: number): boolean {
	const touchesExcludedCategory =
		rule.categories.length === 0 ||
		rule.categories.some((category) => CATEGORIES_EXCLUDED_FROM_NEARBY.includes(category));
	return (
		rule.logicType === 'intersection' && (rule.bufferMetres ?? 0) <= nearbyRadiusMetres && !touchesExcludedCategory
	);
}

/** Mirrors the SQL `consulteeCategory IN (...) AND STDistance(...) <= radius` findConsulteeAreasNear runs. */
function matchesCondition(match: ConsulteeAreaSummaryMatch, rule: RuleCondition): boolean {
	const category = match.feature.properties.consulteeCategory ?? '';
	const categoryMatches = rule.categories.length === 0 || rule.categories.includes(category);
	return categoryMatches && match.distanceMetres <= (rule.bufferMetres ?? 0);
}

// tie-break on id: SQL Server's `ORDER BY distanceMetres` (in findConsulteeAreasNear) has no
// secondary key, so rows tied at the same distance (very common here - most conditions require an
// outright intersection, i.e. distance 0) aren't returned in a guaranteed-stable order between
// separate executions of the same query. Without this, the map/static-map's result order - and so
// its cache fingerprint - could differ between two requests for the exact same underlying matches,
// breaking ETag caching (confirmed: this caused a real, intermittent test failure).
function sortMatches<T extends ConsulteeAreaSummaryMatch>(matches: T[]): T[] {
	return [...matches].sort((a, b) => a.distanceMetres - b.distanceMetres || a.feature.id.localeCompare(b.feature.id));
}

export interface RunRulesetResult {
	/** The ruleset's own matches - the union of every condition, deduplicated, nearest first. */
	matches: ConsulteeAreaMatch[];
	/**
	 * Every consultee area within DEFAULT_NEARBY_RADIUS_METRES, any category, except
	 * CATEGORIES_EXCLUDED_FROM_NEARBY - see its own doc comment and nearbyRadiusMetres below.
	 * Without geometry: this is only ever listed, never drawn.
	 */
	allNearby: ConsulteeAreaSummaryMatch[];
}

/**
 * Run every condition in a ruleset against a project's geometry and combine the results - a
 * ruleset finding "all relevant consultees" means the union of what each of its conditions finds
 * (e.g. the site's hosting council *and* nearby hospitals *and* nearby ambulance trusts...), not
 * any one condition in isolation.
 *
 * Most conditions are `intersection` conditions at or under `nearbyRadiusMetres` (defaulted to
 * DEFAULT_NEARBY_RADIUS_METRES if not given, but a caller running inside a configured app should
 * pass its own value - see e.g. apps/manage's NEARBY_CONSULTEE_RADIUS_KM - so this can be tuned
 * without a code change) - rather than each running its own "is this category within this radius"
 * query, one query fetches everything within that radius up front (which doubles as the default
 * "all nearby consultees" view - see allNearby above) and those conditions are filtered from it in
 * memory. Only conditions needing a wider radius, or `bordering` logic (a different query shape
 * entirely - see runCondition), still run their own query, in bounded-concurrency batches (see
 * CONDITION_CONCURRENCY) - each condition's own query already retries on deadlock (see
 * findConsulteeAreasNear/findConsulteeAreasBordering in consultee-areas.ts). Duplicates (the same
 * consultee area matching more than one condition) are removed, nearest first.
 *
 * The shared fetch skips geometry (a few hundred rows, some of them whole county or National Park
 * boundaries) - geometry is then fetched by id for just the final matches, the only rows the map
 * draws.
 */
export async function runRuleset(
	dbClient: PrismaClient,
	geometry: Geometry,
	ruleset: Ruleset,
	nearbyRadiusMetres: number = DEFAULT_NEARBY_RADIUS_METRES
): Promise<RunRulesetResult> {
	const allNearby = await findConsulteeAreaSummariesNear(
		dbClient,
		geometry,
		nearbyRadiusMetres,
		undefined,
		CATEGORIES_EXCLUDED_FROM_NEARBY
	);

	const resultsByRule: ConsulteeAreaSummaryMatch[][] = [];
	const remainingRules: RuleCondition[] = [];
	for (const rule of ruleset.rules) {
		if (isSatisfiableFromNearby(rule, nearbyRadiusMetres)) {
			resultsByRule.push(allNearby.filter((match) => matchesCondition(match, rule)));
		} else {
			remainingRules.push(rule);
		}
	}

	const knownGeometries = new Map<string, Geometry>();
	for (let i = 0; i < remainingRules.length; i += CONDITION_CONCURRENCY) {
		const batch = remainingRules.slice(i, i + CONDITION_CONCURRENCY);
		const batchResults = await Promise.all(batch.map((rule) => runCondition(dbClient, geometry, rule)));
		for (const matches of batchResults) {
			resultsByRule.push(matches);
			for (const match of matches) {
				knownGeometries.set(match.feature.id, match.feature.geometry);
			}
		}
	}

	const matchesById = new Map<string, ConsulteeAreaSummaryMatch>();
	for (const matches of resultsByRule) {
		for (const match of matches) {
			const existing = matchesById.get(match.feature.id);
			if (!existing || match.distanceMetres < existing.distanceMetres) {
				matchesById.set(match.feature.id, match);
			}
		}
	}

	const missingIds = [...matchesById.keys()].filter((id) => !knownGeometries.has(id));
	const fetchedGeometries = await getConsulteeAreaGeometries(dbClient, missingIds);
	const matches: ConsulteeAreaMatch[] = [];
	for (const match of matchesById.values()) {
		const matchGeometry = knownGeometries.get(match.feature.id) ?? fetchedGeometries.get(match.feature.id);
		// absent only if the row was deleted between the two queries (a reference data reload
		// mid-request) - there's nothing left to draw or notify
		if (matchGeometry) {
			matches.push({
				distanceMetres: match.distanceMetres,
				feature: { ...match.feature, type: 'Feature', geometry: matchGeometry }
			});
		}
	}

	return { matches: sortMatches(matches), allNearby: sortMatches(allNearby) };
}
