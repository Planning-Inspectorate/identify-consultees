import { load } from 'js-yaml';
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
	/**
	 * The rulesets workbook's Group (Administative boundaries, Public bodies, Energy, Transport,
	 * Other) - the tab the exported report lists the condition's consultees on. Not sent to the
	 * screening function.
	 */
	group: string;
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

/** What a "Consultee Type(s)" wording matches: consultee_area categories, and a bordering one's host category. */
export interface ConsulteeTypeMapping {
	categories: string[];
	hostCategory?: string;
}

/** What a Logic wording means: intersects the site, within the row's buffer of it, or borders the host area. */
export type RuleLogic = 'intersection' | 'buffer' | 'bordering';

/**
 * Everything about the rulesets that isn't in their CSVs, from config/rulesets/rulesets.yaml - see
 * the file for what each setting means. The workbook's wordings are keyed normalised (see
 * normalise), so they match case- and space-insensitively.
 */
export interface RulesetSettings {
	/** The ruleset pages pre-select, by file name less `_ruleset.csv`. */
	default: string;
	/** Display names, by file name less `_ruleset.csv` - any other is named from its file name. */
	names: Record<string, string>;
	consulteeTypes: Map<string, ConsulteeTypeMapping>;
	/** The Consultee Type(s) wordings as rulesets.yaml spells them - consulteeTypes keys them normalised. */
	consulteeTypeWordings: string[];
	logic: Map<string, RuleLogic>;
	/**
	 * Categories the rulesets name that no reference data provides yet. Their conditions match
	 * nothing until data with these category names is loaded - deliberately, rather than being left
	 * out of the rulesets (see kt-docs/data/screening-engine.md).
	 */
	categoriesAwaitingData: ReadonlySet<string>;
}

const SETTINGS_FILE = 'rulesets.yaml';
const RULE_LOGICS: RuleLogic[] = ['intersection', 'buffer', 'bordering'];

function normalise(text: string): string {
	return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
	throw new Error(`${SETTINGS_FILE}: ${message}`);
}

/** Refuse keys a section doesn't have - a typo would otherwise be silently ignored. */
function onlyKeys(section: Record<string, unknown>, allowed: string[], name: string): void {
	const unknown = Object.keys(section).filter((key) => !allowed.includes(key));
	if (unknown.length > 0) {
		fail(`${name} has ${unknown.map((key) => `"${key}"`).join(', ')} - it can only have ${allowed.join(', ')}`);
	}
}

function isText(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

/** A section keyed by the workbook's wording, each wording once however it's cased or spaced. */
function parseWordings<T>(value: unknown, name: string, parse: (entry: unknown, where: string) => T): Map<string, T> {
	if (!isRecord(value) || Object.keys(value).length === 0) {
		fail(`${name} must map at least one of the workbook's wordings to what it means`);
	}
	const wordings = new Map<string, T>();
	for (const [wording, entry] of Object.entries(value)) {
		const key = normalise(wording);
		if (wordings.has(key)) {
			fail(`${name} lists "${wording}" twice`);
		}
		wordings.set(key, parse(entry, `${name}.${wording}`));
	}
	return wordings;
}

function parseConsulteeType(value: unknown, name: string): ConsulteeTypeMapping {
	if (!isRecord(value)) {
		fail(`${name} must set categories`);
	}
	onlyKeys(value, ['categories', 'hostCategory'], name);
	const { categories, hostCategory } = value;
	if (!Array.isArray(categories) || categories.length === 0 || !categories.every(isText)) {
		fail(`${name}.categories must list at least one consultee category`);
	}
	if (hostCategory !== undefined && !isText(hostCategory)) {
		fail(`${name}.hostCategory must be a consultee category`);
	}
	return {
		categories: categories.map((category) => category.trim()),
		...(hostCategory === undefined ? {} : { hostCategory: hostCategory.trim() })
	};
}

function parseLogic(value: unknown, name: string): RuleLogic {
	if (!RULE_LOGICS.includes(value as RuleLogic)) {
		fail(`${name} must be intersection, buffer or bordering`);
	}
	return value as RuleLogic;
}

function parseRulesetFileNames(value: unknown, name: string): Record<string, string> {
	if (!isRecord(value)) {
		fail(`${name} must map file names to display names`);
	}
	for (const [file, displayName] of Object.entries(value)) {
		if (!isText(displayName)) {
			fail(`${name}.${file} must be a display name`);
		}
	}
	return Object.fromEntries(Object.entries(value).map(([file, displayName]) => [file, String(displayName).trim()]));
}

export function parseRulesetSettings(text: string): RulesetSettings {
	const document = text.trim() === '' ? null : load(text);
	if (!isRecord(document) || document.version !== 1) {
		fail('must be a version 1 document');
	}
	onlyKeys(
		document,
		['version', 'default', 'names', 'consulteeTypes', 'logic', 'categoriesAwaitingData'],
		'the document'
	);
	if (!isText(document.default)) {
		fail('default must be the file name, less _ruleset.csv, of the ruleset pages pre-select');
	}
	const awaiting = document.categoriesAwaitingData ?? [];
	if (!Array.isArray(awaiting) || !awaiting.every(isText)) {
		fail('categoriesAwaitingData must list consultee categories');
	}
	return {
		default: document.default.trim(),
		names: parseRulesetFileNames(document.names ?? {}, 'names'),
		consulteeTypes: parseWordings(document.consulteeTypes, 'consulteeTypes', parseConsulteeType),
		// parseWordings has checked it's a record
		consulteeTypeWordings: Object.keys(document.consulteeTypes as Record<string, unknown>).map((wording) =>
			wording.trim()
		),
		logic: parseWordings(document.logic, 'logic', parseLogic),
		categoriesAwaitingData: new Set(awaiting.map((category) => category.trim()))
	};
}

/**
 * The Consultee Type(s) wordings a ruleset can use, as rulesets.yaml spells them, each saying
 * whether it awaits data - every category it matches is in categoriesAwaitingData, so its
 * conditions find nothing yet. The help page lists them for whoever edits the workbook.
 */
export function acceptedConsulteeTypes(
	settings: RulesetSettings = RULESET_SETTINGS
): { wording: string; awaitingData: boolean }[] {
	return settings.consulteeTypeWordings.map((wording) => {
		const categories = settings.consulteeTypes.get(normalise(wording))?.categories ?? [];
		return {
			wording,
			awaitingData:
				categories.length > 0 && categories.every((category) => settings.categoriesAwaitingData.has(category))
		};
	});
}

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
 * row's Consultee Type(s) and Logic are looked up in the settings' consulteeTypes and logic;
 * anything unrecognised, a buffer that isn't a number, a buffer on a condition that can't have one,
 * or two rows that would get the same id throws, naming the row.
 */
export function parseRulesetCsv(contents: string, settings: RulesetSettings = RULESET_SETTINGS): RuleCondition[] {
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

		const mapping = settings.consulteeTypes.get(normalise(cell('Consultee Type(s)')));
		if (!mapping) {
			throw new Error(`Unknown consultee type in ${where} - add it to consulteeTypes in ${SETTINGS_PATH}`);
		}
		const logic = settings.logic.get(normalise(cell('Logic')));
		if (!logic) {
			throw new Error(`Unknown logic "${cell('Logic')}" in ${where} - add it to logic in ${SETTINGS_PATH}`);
		}
		const bufferKm = cell('Buffer (km)') === '' ? 0 : Number(cell('Buffer (km)'));
		if (!Number.isFinite(bufferKm) || bufferKm < 0) {
			throw new Error(`Buffer (km) must be a number of 0 or more in ${where}`);
		}
		if (bufferKm > 0 && logic !== 'buffer') {
			throw new Error(`Only a buffer logic can have a buffer, in ${where}`);
		}
		const logicType: RuleLogicType = logic === 'bordering' ? 'bordering' : 'intersection';
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
		const group = cell('Group');
		return logicType === 'bordering'
			? { id, name, group, logicType, categories: mapping.categories, hostCategory: mapping.hostCategory }
			: { id, name, group, logicType, categories: mapping.categories, bufferMetres: bufferKm * 1000 };
	});
}

/** Build one named Ruleset from a whole CSV export - every row becomes one of its conditions. */
export function buildRulesetFromCsv(
	id: string,
	name: string,
	contents: string,
	settings: RulesetSettings = RULESET_SETTINGS
): Ruleset {
	return { id, name, rules: parseRulesetCsv(contents, settings) };
}

// Every ruleset is one sheet of the rulesets workbook saved as `<name>_ruleset.csv` in
// config/rulesets/, with rulesets.yaml - among the other files a maintainer edits (see
// config/README.md)
const RULESETS_DIR = path.join(CONFIG_DIR, 'rulesets');
const RULESET_FILE_SUFFIX = '_ruleset.csv';
const SETTINGS_PATH = `config/rulesets/${SETTINGS_FILE}`;

export const RULESET_SETTINGS = parseRulesetSettings(readFileSync(path.join(RULESETS_DIR, SETTINGS_FILE), 'utf8'));

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
 * Every `*_ruleset.csv` in `dir`: the settings' default first (pages use RULESETS[0]), then the
 * rest in file-name order, each with its display name from the settings or else its file name. A
 * default or name for a file that isn't there throws, naming it, rather than being ignored.
 */
export function loadRulesets(dir: string = RULESETS_DIR, settings: RulesetSettings = RULESET_SETTINGS): Ruleset[] {
	const files = readdirSync(dir)
		.filter((file) => file.endsWith(RULESET_FILE_SUFFIX))
		.sort();
	if (files.length === 0) {
		throw new Error(`No ruleset exports (*${RULESET_FILE_SUFFIX}) found in ${dir}`);
	}
	const stems = files.map(rulesetStem);
	for (const [setting, stem] of [
		['default', settings.default],
		...Object.keys(settings.names).map((stem) => [`names.${stem}`, stem])
	]) {
		if (!stems.includes(stem)) {
			throw new Error(
				`${SETTINGS_FILE}: ${setting} names "${stem}", but there's no ${stem}${RULESET_FILE_SUFFIX} - use one of ${stems.join(', ')}`
			);
		}
	}
	const rulesets = files.map((file) =>
		buildRulesetFromCsv(
			rulesetIdFromFileName(file),
			Object.hasOwn(settings.names, rulesetStem(file))
				? settings.names[rulesetStem(file)]
				: rulesetNameFromFileName(file),
			readFileSync(path.join(dir, file), 'utf8'),
			settings
		)
	);
	const names = rulesets.map((ruleset) => ruleset.name);
	const repeated = names.find((name, index) => names.indexOf(name) !== index);
	if (repeated) {
		throw new Error(`${SETTINGS_FILE}: two rulesets would both be named "${repeated}" - give one a name under names`);
	}
	const defaultId = rulesetIdFromFileName(settings.default);
	return [
		...rulesets.filter((ruleset) => ruleset.id === defaultId),
		...rulesets.filter((ruleset) => ruleset.id !== defaultId)
	];
}

// Saving another sheet of the rulesets workbook as `<name>_ruleset.csv` in config/rulesets/ is all
// it takes for the app to offer it - rulesets.yaml only needs changing for a new wording.
export const RULESETS: Ruleset[] = loadRulesets();

export function getRuleset(id: string): Ruleset | undefined {
	return RULESETS.find((ruleset) => ruleset.id === id);
}

/**
 * Why an area is a consultee: a ruleset condition it met (by the condition's id - see
 * RuleCondition), the general search for every consultee within the nearby radius, or - for
 * another case, a Nearby NSIP - being within the Nearby NSIPs distance of the site.
 */
export type ConsulteeReason =
	| { type: 'condition'; conditionId: string }
	| { type: 'nearby'; radiusMetres: number }
	| { type: 'nearbyNsip'; radiusMetres: number };

/** One consultee a ruleset run found, with every reason it qualified. */
export interface ConsulteeMatch {
	/** Condition matches carry their original geometry; nearby-only ones don't (they're drawn from display geometry). */
	feature: ConsulteeAreaSummary & { geometry?: Geometry };
	distanceMetres: number;
	reasons: ConsulteeReason[];
}

/**
 * True when the consultee is report content: a ruleset condition identified it, or it's a Nearby
 * NSIP - false when only the general nearby search found it. The report lists only the first kind;
 * maps show both, the second fainter.
 */
export function isIdentified(match: Pick<ConsulteeMatch, 'reasons'>): boolean {
	return match.reasons.some((reason) => reason.type !== 'nearby');
}

/**
 * What a run screened: the site's outline, or - for a site too detailed to screen in time - the
 * rectangle around it, which finds every consultee the outline would and more besides.
 */
export type SiteScreenedAs = 'outline' | 'boundingBox';

export interface RunRulesetResult {
	/** Every consultee, nearest first, each once: what any condition met, and everything nearby. */
	consultees: ConsulteeMatch[];
	/** The outline unless said otherwise. */
	siteScreenedAs?: SiteScreenedAs;
}
