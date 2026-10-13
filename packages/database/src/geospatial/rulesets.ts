import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from '../config-dir.ts';
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
 * needs to notify. Each is one sheet of the rulesets workbook, saved as `<name>_ruleset.csv` in
 * config/rulesets/ (see loadRulesets).
 */
export interface Ruleset {
	id: string;
	name: string;
	rules: RuleCondition[];
}

/**
 * What each "Consultee Type(s)" in the rulesets workbook matches in the reference data: the
 * consultee_area categories, and for a bordering condition the category of the host area. Keyed by
 * the workbook's own wording (compared case- and space-insensitively). A wording missing from here
 * stops the app at startup (see parseRulesetCsv) rather than silently matching nothing - add it
 * here when the workbook gains a new consultee type.
 */
interface ConsulteeTypeMapping {
	categories: string[];
	hostCategory?: string;
}

const LOCAL_AUTHORITIES = {
	parish: 'Parish Council',
	district: 'Lower Tier Authority',
	unitary: 'Unitary Authority',
	county: 'Upper Tier Authority',
	nationalPark: 'National Park'
} as const;

const CONSULTEE_TYPES: [string, ConsulteeTypeMapping][] = [
	// administrative boundaries - see the workbook's A-D_authorities sheet
	['Parish / Town / Community Councils', { categories: [LOCAL_AUTHORITIES.parish] }],
	[
		'Community Councils bordering B Host Community Councils',
		{ categories: [LOCAL_AUTHORITIES.parish], hostCategory: LOCAL_AUTHORITIES.parish }
	],
	['District Councils (Lower Tier Authorities)', { categories: [LOCAL_AUTHORITIES.district] }],
	['Unitary Authorities', { categories: [LOCAL_AUTHORITIES.unitary] }],
	// Broads Authority areas are expected within the National Park data
	['National Parks & Broads', { categories: [LOCAL_AUTHORITIES.nationalPark] }],
	['County Councils (Upper Tier Authorities)', { categories: [LOCAL_AUTHORITIES.county] }],
	[
		'District Councils, Unitary Authorities, National Parks & Broads bordering B Host District Councils',
		{
			categories: [LOCAL_AUTHORITIES.district, LOCAL_AUTHORITIES.unitary, LOCAL_AUTHORITIES.nationalPark],
			hostCategory: LOCAL_AUTHORITIES.district
		}
	],
	[
		'County Councils, District Councils, Unitary Authorities, National Parks & Broads bordering B Host Unitary Authorities',
		{
			categories: [
				LOCAL_AUTHORITIES.county,
				LOCAL_AUTHORITIES.district,
				LOCAL_AUTHORITIES.unitary,
				LOCAL_AUTHORITIES.nationalPark
			],
			hostCategory: LOCAL_AUTHORITIES.unitary
		}
	],
	[
		'County Councils, Unitary Authorities, National Parks & Broads and District Councils bordering B Host Unitary Authorities',
		{
			categories: [
				LOCAL_AUTHORITIES.county,
				LOCAL_AUTHORITIES.district,
				LOCAL_AUTHORITIES.unitary,
				LOCAL_AUTHORITIES.nationalPark
			],
			hostCategory: LOCAL_AUTHORITIES.unitary
		}
	],
	[
		'County Councils, Unitary Authorities, National Parks & Broads bordering C Host County Councils',
		{
			categories: [LOCAL_AUTHORITIES.county, LOCAL_AUTHORITIES.unitary, LOCAL_AUTHORITIES.nationalPark],
			hostCategory: LOCAL_AUTHORITIES.county
		}
	],
	['Greater London Authority', { categories: ['Greater London Authority'] }],
	// public bodies
	['National Landscapes (formerly AONBs)', { categories: ['National Landscape'] }],
	[
		'Internal Drainage Boards (England & Wales)',
		{ categories: ['Internal Drainage Board', 'Internal Drainage District'] }
	],
	['Ambulance Trusts', { categories: ['Ambulance Trust'] }],
	['Fire & Rescue Authorities', { categories: ['Fire and Rescue Authority'] }],
	// police force areas, which are also the PCCs' areas
	['Police & Crime Commissioners', { categories: ['Police'] }],
	['Hospitals operated by NHS Trusts and NHS Foundation Trusts (England)', { categories: ['Hospital'] }],
	['Integrated Care Boards (England)', { categories: ['ICB'] }],
	['Local Health Boards (Wales)', { categories: ['Local Health Board'] }],
	['Local Resilience Forums', { categories: ['Local Resilience Forum'] }],
	// energy
	[
		'Electricity Generators (Biomass, Coal, Energy from Waste, Hydroelectric, Hydrogen, Natural Gas, Nuclear, Offshore Wind, Onshore Wind, Solar, Tidal, Other, Unknown)',
		{ categories: ['Electricity Generator'] }
	],
	['Offshore Wind Sites', { categories: ['Offshore Wind Site'] }],
	['Wind Export Cables', { categories: ['Offshore Wind Export Cable'] }],
	['Electricity Distribution Networks', { categories: ['DNO'] }],
	['Electricity Interconnectors (Built, Proposed, Scoping)', { categories: ['Interconnector'] }],
	['Office for Nuclear Regulation Sites', { categories: ['ONR Site'] }],
	// transport
	['Canals England & Wales', { categories: ['Canal'] }],
	['Railways', { categories: ['Railway'] }],
	['Passenger Transport Executives', { categories: ['Passenger Transport Executive'] }],
	['Integrated Transport Authorities', { categories: ['Integrated Transport Authority'] }],
	['Docks / Harbours operated by Statutory Harbour Authorities', { categories: ['Dock or Harbour'] }],
	['Joint Transport Authorities (Wales)', { categories: ['Joint Transport Authority'] }],
	// other
	['MoD Safeguarding Areas', { categories: ['MOD Safeguarding Area'] }],
	['MoD Low Flying Areas (Green, Amber, Red, Blue)', { categories: ['MOD Low Flying Area'] }],
	['Coal Mining Reporting Areas', { categories: ['Coal Mining Reporting Area'] }],
	['Cheshire Brine Area', { categories: ['Cheshire Brine Area'] }]
];

/**
 * Categories the rulesets name that no reference data provides yet. Their conditions match
 * nothing until data with these category names is loaded - deliberately, rather than being left
 * out of the rulesets (see kt-docs/data/screening-engine.md).
 */
export const CATEGORIES_AWAITING_DATA: ReadonlySet<string> = new Set([
	'Canal',
	'Joint Transport Authority',
	'MOD Safeguarding Area',
	'MOD Low Flying Area',
	'Coal Mining Reporting Area',
	'Cheshire Brine Area'
]);

function normalise(text: string): string {
	return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

const CONSULTEE_TYPE_MAPPINGS = new Map(CONSULTEE_TYPES.map(([type, mapping]) => [normalise(type), mapping]));

/** The workbook's Logic column: within the site itself, within a buffer of it, or bordering a host area. */
const LOGIC_TYPES = new Map<string, RuleLogicType>([
	['intersects application site', 'intersection'],
	['intersects application site buffer', 'intersection'],
	['borders host authority', 'bordering']
]);

const RULESET_CSV_COLUMNS = [
	'Group hierarchy',
	'Group',
	'Category',
	'Consultee Type(s)',
	'Logic',
	'Buffer (km)'
] as const;

/**
 * Split CSV text into rows of fields, as Excel saves it: comma-separated, a field quoted when it
 * holds a comma, quote or line break, and `""` for a quote inside one. Tolerates a byte-order
 * mark and CRLF line endings.
 */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	const input = text.replace(/^\uFEFF/, '');
	for (let i = 0; i < input.length; i++) {
		const char = input[i];
		if (quoted) {
			if (char === '"' && input[i + 1] === '"') {
				field += '"';
				i++;
			} else if (char === '"') {
				quoted = false;
			} else {
				field += char;
			}
		} else if (char === '"') {
			quoted = true;
		} else if (char === ',') {
			row.push(field);
			field = '';
		} else if (char === '\n' || char === '\r') {
			if (char === '\r' && input[i + 1] === '\n') {
				i++;
			}
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else {
			field += char;
		}
	}
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

/** The workbook's Category column for an administrative authority: "B Host Authority", "A Bordering Authority"... */
const AUTHORITY_CATEGORY = /^([A-D]) (host|bordering) authority$/i;

function slug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_|_$/g, '');
}

/**
 * How a condition reads on the report pages: a host or bordering authority keeps its A-D letter,
 * as the workbook's A-D_authorities sheet defines them - `"B" host Unitary Authorities`,
 * `"A" Community Councils bordering "B" host Community Councils` - and anything else is its
 * consultee type as written.
 */
function conditionName(category: string, consulteeType: string): string {
	const authority = AUTHORITY_CATEGORY.exec(category.trim());
	const type = consulteeType.replace(/ bordering ([A-D]) Host /, ' bordering "$1" host ');
	if (!authority) {
		return type;
	}
	return authority[2].toLowerCase() === 'host'
		? `"${authority[1].toUpperCase()}" host ${type}`
		: `"${authority[1].toUpperCase()}" ${type}`;
}

/**
 * Parse one ruleset - one sheet of the rulesets workbook saved as CSV - into RuleConditions. Each
 * row's Consultee Type(s) is looked up in CONSULTEE_TYPES and its Logic in LOGIC_TYPES; anything
 * unrecognised, a buffer that isn't a number, a buffer on a condition that can't have one, or two
 * rows that would get the same id throws, naming the row.
 */
export function parseRulesetCsv(contents: string): RuleCondition[] {
	const [header, ...rows] = parseCsv(contents);
	const columns = (header ?? []).map((column) => column.trim().toLowerCase());
	const indexOf = Object.fromEntries(
		RULESET_CSV_COLUMNS.map((expected) => {
			const index = columns.indexOf(expected.toLowerCase());
			if (index === -1) {
				throw new Error(`Ruleset CSV is missing expected column "${expected}"`);
			}
			return [expected, index];
		})
	) as Record<(typeof RULESET_CSV_COLUMNS)[number], number>;

	const ids = new Set<string>();
	return rows.map((cells, index) => {
		const cell = (column: (typeof RULESET_CSV_COLUMNS)[number]) => (cells[indexOf[column]] ?? '').trim();
		const where = `ruleset row ${index + 2} ("${cell('Consultee Type(s)')}")`;

		const mapping = CONSULTEE_TYPE_MAPPINGS.get(normalise(cell('Consultee Type(s)')));
		if (!mapping) {
			throw new Error(`Unknown consultee type in ${where} - add it to CONSULTEE_TYPES in rulesets.ts`);
		}
		const logicType = LOGIC_TYPES.get(normalise(cell('Logic')));
		if (!logicType) {
			throw new Error(`Unknown logic "${cell('Logic')}" in ${where}`);
		}
		const bufferKm = cell('Buffer (km)') === '' ? 0 : Number(cell('Buffer (km)'));
		if (!Number.isFinite(bufferKm) || bufferKm < 0) {
			throw new Error(`Buffer (km) must be a number of 0 or more in ${where}`);
		}
		if (bufferKm > 0 && normalise(cell('Logic')) !== 'intersects application site buffer') {
			throw new Error(`Only "Intersects application site buffer" can have a buffer, in ${where}`);
		}
		if (logicType === 'bordering' && !mapping.hostCategory) {
			throw new Error(`A bordering condition needs a host authority, in ${where}`);
		}

		const authority = AUTHORITY_CATEGORY.exec(cell('Category'));
		const id = [
			authority ? `${authority[1]}_${authority[2]}`.toLowerCase() : '',
			slug(cell('Consultee Type(s)')),
			bufferKm > 0 ? `${bufferKm}km` : ''
		]
			.filter(Boolean)
			.join('_');
		if (ids.has(id)) {
			throw new Error(`Two rows would both be condition "${id}" - ${where} repeats an earlier row`);
		}
		ids.add(id);

		const name = conditionName(cell('Category'), cell('Consultee Type(s)'));
		return logicType === 'bordering'
			? { id, name, logicType, categories: mapping.categories, hostCategory: mapping.hostCategory }
			: { id, name, logicType, categories: mapping.categories, bufferMetres: bufferKm * 1000 };
	});
}

/** Build one named Ruleset from a whole CSV export - every row becomes one of its conditions. */
export function buildRulesetFromCsv(id: string, name: string, contents: string): Ruleset {
	return { id, name, rules: parseRulesetCsv(contents) };
}

// Every ruleset is one sheet of the rulesets workbook saved as `<name>_ruleset.csv` in
// config/rulesets/ - with the other files a maintainer edits (see config/README.md)
const RULESETS_DIR = path.join(CONFIG_DIR, 'rulesets');
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

/**
 * The ruleset pages pre-select when none is chosen: England and Wales after 30 April 2024, which
 * most new applications fall under. Set explicitly rather than taken from file-name order, which
 * would make "England pre 30 April 2024" the default.
 */
export const DEFAULT_RULESET_ID = 'england-wales-post-20240430';

/**
 * Every `*_ruleset.csv` in `dir`: `defaultId`'s first (it's the default - pages use RULESETS[0]),
 * then the rest in file-name order.
 */
export function loadRulesets(dir: string = RULESETS_DIR, defaultId: string = DEFAULT_RULESET_ID): Ruleset[] {
	const files = readdirSync(dir)
		.filter((file) => file.endsWith(RULESET_FILE_SUFFIX))
		.sort();
	if (files.length === 0) {
		throw new Error(`No ruleset exports (*${RULESET_FILE_SUFFIX}) found in ${dir}`);
	}
	const rulesets = files.map((file) =>
		buildRulesetFromCsv(
			rulesetIdFromFileName(file),
			rulesetNameFromFileName(file),
			readFileSync(path.join(dir, file), 'utf8')
		)
	);
	return [
		...rulesets.filter((ruleset) => ruleset.id === defaultId),
		...rulesets.filter((ruleset) => ruleset.id !== defaultId)
	];
}

// Saving another sheet of the rulesets workbook as `<name>_ruleset.csv` in config/rulesets/ is all
// it takes for the app to offer it.
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

/**
 * True when a ruleset condition identified the consultee - false when only the general nearby
 * search found it. The report lists only the first kind; maps show both, the second fainter.
 */
export function isIdentifiedByCondition(match: Pick<ConsulteeMatch, 'reasons'>): boolean {
	return match.reasons.some((reason) => reason.type === 'condition');
}

export interface RunRulesetResult {
	/** Every consultee, nearest first, each once: what any condition met, and everything nearby. */
	consultees: ConsulteeMatch[];
}
