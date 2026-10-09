import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConsulteeAreaSummary } from './consultee-areas.ts';
import type { Geometry } from './wkt.ts';

/**
 * One condition within a ruleset (one row of a ruleset export - see loadRulesets below).
 * A ruleset is made up of many of these; running the ruleset means running every one of its
 * conditions and combining the results - which the Python function does (apps/function-python,
 * intersector/screening.py; the manage app sends it these definitions) - a single condition on its own (e.g.
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

// Every ruleset is its own CSV export, named `<name>_ruleset.csv`, co-located with this module (not
// under apps/function-python/setup_database/sample_data, where the first one originally lived) so
// it's guaranteed to exist wherever packages/database is deployed - a cross-app relative path here
// previously crashed the manage app's Docker image at startup, since that image only ever copies
// packages/ and apps/manage/, never apps/function-python
const RULESETS_DIR = path.dirname(fileURLToPath(import.meta.url));
const RULESET_FILE_SUFFIX = '_ruleset.csv';

const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

// joining words stay lower case in a ruleset's display name, so `england_and_wales_post_...` reads
// "England and Wales post ..." rather than "England And Wales Post ..."
const LOWER_CASE_WORDS = new Set([
	'and',
	'or',
	'of',
	'the',
	'in',
	'on',
	'to',
	'from',
	'pre',
	'post',
	'before',
	'after'
]);

function rulesetStem(fileName: string): string {
	return path.basename(fileName, RULESET_FILE_SUFFIX);
}

/** A ruleset's id - used in `?ruleset=` URLs - from its CSV's file name: `england_wales_post_20240430_ruleset.csv` → `england-wales-post-20240430`. */
export function rulesetIdFromFileName(fileName: string): string {
	return rulesetStem(fileName).toLowerCase().replaceAll('_', '-');
}

/**
 * A ruleset's display name from its CSV's file name: words capitalised (except joining words like
 * "and" or "post"), and a `YYYYMMDD` date written out - `england_wales_post_20240430_ruleset.csv`
 * → "England Wales post 30 April 2024". Rename the file to change what users see.
 */
export function rulesetNameFromFileName(fileName: string): string {
	const words = rulesetStem(fileName)
		.split('_')
		.filter(Boolean)
		.map((word, index) => {
			const date = /^(\d{4})(\d{2})(\d{2})$/.exec(word);
			const month = date ? MONTHS[Number(date[2]) - 1] : undefined;
			if (date && month && Number(date[3]) >= 1 && Number(date[3]) <= 31) {
				return `${Number(date[3])} ${month} ${date[1]}`;
			}
			const lower = word.toLowerCase();
			return index > 0 && LOWER_CASE_WORDS.has(lower) ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
		});
	return words.join(' ');
}

/** Every `*_ruleset.csv` in `dir`, in file-name order - the first is the default ruleset. */
export function loadRulesets(dir: string = RULESETS_DIR): Ruleset[] {
	const files = readdirSync(dir)
		.filter((file) => file.endsWith(RULESET_FILE_SUFFIX))
		.sort();
	if (files.length === 0) {
		throw new Error(`No ruleset exports (*${RULESET_FILE_SUFFIX}) found in ${dir}`);
	}
	return files.map((file) =>
		buildRulesetFromCsv(
			rulesetIdFromFileName(file),
			rulesetNameFromFileName(file),
			readFileSync(path.join(dir, file), 'utf8')
		)
	);
}

// Only one ruleset exists yet. The real set (around 8) arrives as more CSV exports in the same
// shape - dropping each in alongside this module is all it takes for the app to offer it.
export const RULESETS: Ruleset[] = loadRulesets();

export function getRuleset(id: string): Ruleset | undefined {
	return RULESETS.find((ruleset) => ruleset.id === id);
}

/**
 * Why an area is a consultee: a ruleset condition it met (by the condition's id - see
 * RuleCondition), or the general search for every consultee within the nearby radius.
 */
export type ConsulteeReason = { type: 'condition'; conditionId: string } | { type: 'nearby'; radiusMetres: number };

/** One consultee a ruleset run found, with every reason it qualified. */
export interface ConsulteeMatch {
	/** Condition matches carry their original geometry; nearby-only ones don't (they're drawn from display geometry). */
	feature: ConsulteeAreaSummary & { geometry?: Geometry };
	distanceMetres: number;
	reasons: ConsulteeReason[];
}

export interface RunRulesetResult {
	/** Every consultee, nearest first, each once: what any condition met, and everything nearby. */
	consultees: ConsulteeMatch[];
}
