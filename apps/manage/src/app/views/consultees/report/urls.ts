/**
 * The consultee selections the report pages carry in their URLs. There's no server-side state:
 * which consultee areas the user removed (via a category's Change page) lives in the `exclude`
 * query params - each a small JSON object recording the match id it excludes and the reason it
 * was removed - and consultees added by hand live in repeated `add` params, so the check page's
 * counts, the category page's rows and the maps drawn from the same URL always agree.
 */

// Front Door's firewall (the managed rule set in infrastructure/front-door.tf) scores plain JSON in
// a query string as an injection attempt - its quotes, colons and words add up past the block
// threshold, and the request never reaches the app. So each entry travels base64url-encoded
// (`eyJ...` is how `{"` encodes); one that arrives as plain JSON, from a link made before, still reads.
const ENCODED_JSON = /^eyJ[A-Za-z0-9_-]*$/;

/** A selection entry as its URL param carries it: JSON, base64url-encoded. */
export function encodeSelectionEntry(entry: Record<string, string>): string {
	return Buffer.from(JSON.stringify(entry), 'utf8').toString('base64url');
}

/** A selection entry's JSON, from its URL param - base64url-encoded, or plain from an older link. */
export function decodeSelectionEntry(raw: string): string {
	return ENCODED_JSON.test(raw) ? Buffer.from(raw, 'base64url').toString('utf8') : raw;
}

/** Every value of a possibly-repeated query param (`?exclude=a&exclude=b` parses to an array). */
export function queryValues(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === 'string' && item !== '');
	}
	return typeof value === 'string' && value !== '' ? [value] : [];
}

/** A consultee removed on a category's Change page, with the reason given for removing it. */
export interface RemovedConsultee {
	/**
	 * The excluded ruleset match's feature id - absent when a hand-added consultee was removed
	 * (that removal drops the `add` param instead, so there is no match to exclude).
	 */
	id?: string;
	/** The category it was removed from - the page whose Removed consultees section lists it. */
	category: string;
	name: string;
	/** Why it was removed - required by the remove form. */
	reason: string;
}

/**
 * The consultee removals on the request: each `exclude` param is a small JSON object
 * (`{"i":matchId,"c":category,"n":name,"r":reason}`, base64url-encoded - see ENCODED_JSON) - one
 * param per entry so a removal and its reason can't drift out of step, and encoded JSON so any
 * name/reason text survives a query string unambiguously. A bare `exclude=<id>` value (a link predating reasons, or the static
 * map's) still excludes that match but has nothing to list in a Removed consultees section.
 * Malformed or incomplete entries are ignored rather than failing the page.
 */
export function removedConsultees(value: unknown): RemovedConsultee[] {
	return queryValues(value).flatMap((raw) => {
		const entry = parseEntry(raw);
		if (entry === undefined) {
			return [{ id: raw, category: '', name: '', reason: '' }];
		}
		return entry ? [entry] : [];
	});
}

/** A selection entry's fields - an add's and a removal's are the same. */
interface SelectionEntry {
	id?: string;
	category: string;
	name: string;
	reason: string;
}

/**
 * An `add` or `exclude` param's entry: undefined when it isn't a JSON object (a bare id), null when
 * it is but has no category or name.
 */
function parseEntry(raw: string): SelectionEntry | null | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(decodeSelectionEntry(raw));
	} catch {
		return undefined;
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return undefined;
	}
	const { i, c, n, r } = parsed as { i?: unknown; c?: unknown; n?: unknown; r?: unknown };
	if (typeof c !== 'string' || c === '' || typeof n !== 'string' || n === '') {
		return null;
	}
	return {
		...(typeof i === 'string' && i !== '' ? { id: i } : {}),
		category: c,
		name: n,
		reason: typeof r === 'string' ? r : ''
	};
}

/** The consultee_area ids of the nearby consultees added by hand (a typed name matched to one). */
export function addedMatchIds(adds: readonly AddedConsultee[]): Set<string> {
	return new Set(adds.flatMap((add) => (add.id ? [add.id] : [])));
}

/** The consultee_area ids a removal list excludes, as a Set for `has()` lookups. */
export function excludedMatchIds(removed: readonly RemovedConsultee[]): Set<string> {
	return new Set(removed.flatMap((removal) => (removal.id ? [removal.id] : [])));
}

/** The excluded consultee_area ids on the request - see removedConsultees for the param shapes. */
export function excludedIds(value: unknown): Set<string> {
	return excludedMatchIds(removedConsultees(value));
}

/**
 * A consultee added by hand on a category's Change page: one the nearby search found (the typed
 * name matched it, so it has an area to map), or one by any other name (a table row only).
 */
export interface AddedConsultee {
	/** The matched nearby consultee's consultee_area id - absent for any other name. */
	id?: string;
	/** The ruleset category it was added under - the page and check-page count it belongs to. */
	category: string;
	name: string;
	/** Why it was identified, shown in the Identified column. */
	reason: string;
}

/**
 * The manually-added consultees on the request: each `add` param is a small JSON object
 * (`{"i":consulteeAreaId,"c":category,"n":name,"r":reason}`, `i` only for a picked nearby
 * consultee; base64url-encoded - see ENCODED_JSON) - one param per entry so they can't drift out
 * of step,
 * and encoded JSON so any name/reason text survives a query string unambiguously. Malformed or
 * incomplete entries are ignored rather than failing the page.
 */
export function addedConsultees(value: unknown): AddedConsultee[] {
	return queryValues(value).flatMap((raw) => parseEntry(raw) ?? []);
}

function encodeEntry(entry: SelectionEntry): string {
	// an id-only removal round-trips as the bare param it arrived as
	if (!entry.name) {
		return entry.id ?? '';
	}
	return encodeSelectionEntry({
		...(entry.id ? { i: entry.id } : {}),
		c: entry.category,
		n: entry.name,
		r: entry.reason
	});
}

/**
 * The consultee-selection state a report URL carries: removed consultees (each excluding its
 * match, if it was one, and listed in the category page's Removed consultees section) and
 * manually-added consultees, in page order. Every report-page URL builder takes the same shape
 * so state can't be dropped by passing a link through the wrong helper.
 */
export interface ConsulteeSelection {
	removed: readonly RemovedConsultee[];
	adds: readonly AddedConsultee[];
}

/** The selection a report-page request's query params carry (`?exclude=` and `?add=`). */
export function consulteeSelection(query?: Record<string, unknown>): ConsulteeSelection {
	return { removed: removedConsultees(query?.exclude), adds: addedConsultees(query?.add) };
}

/** No removals and no additions - the selection the map page's links carry. */
const NO_SELECTION: ConsulteeSelection = { removed: [], adds: [] };

function appendSelection(url: string, selection: ConsulteeSelection): string {
	// the picker URL only carries a query string once a ruleset is chosen, so the first param
	// may need to open it
	const separator = () => (url.includes('?') ? '&' : '?');
	for (const removal of selection.removed) {
		url += `${separator()}exclude=${encodeURIComponent(encodeEntry(removal))}`;
	}
	for (const add of selection.adds) {
		url += `${separator()}add=${encodeURIComponent(encodeEntry(add))}`;
	}
	return url;
}

/** A report page's URL: the case's page at `path`, its ruleset, any `params`, then the selection. */
function reportPageUrl(
	caseId: string,
	path: string,
	rulesetId: string,
	selection: ConsulteeSelection,
	params = ''
): string {
	return appendSelection(
		`/consultees/${encodeURIComponent(caseId)}/${path}?ruleset=${encodeURIComponent(rulesetId)}${params}`,
		selection
	);
}

const categoryParam = (category: string) => `&category=${encodeURIComponent(category)}`;

/**
 * The ruleset picker page - where the boundary page's "Continue" and the check page's
 * "Change"/back links lead. `rulesetId` is present only when the user has already picked a
 * ruleset (the links the check page builds) - the picker's radios are never pre-selected, so
 * the boundary page's "Continue" leads here without one.
 */
export function rulesetUrl(caseId: string, rulesetId?: string, selection: ConsulteeSelection = NO_SELECTION): string {
	let url = `/consultees/${encodeURIComponent(caseId)}/ruleset`;
	if (rulesetId) {
		url += `?ruleset=${encodeURIComponent(rulesetId)}`;
	}
	return appendSelection(url, selection);
}

/** The report check page ("Identify consultees" destination) for a boundary/ruleset/selection. */
export function reportUrl(caseId: string, rulesetId: string, selection: ConsulteeSelection = NO_SELECTION): string {
	return reportPageUrl(caseId, 'report', rulesetId, selection);
}

/** The "Report created" confirmation page the check page's Generate report leads to. */
export function reportCreatedUrl(
	caseId: string,
	rulesetId: string,
	selection: ConsulteeSelection = NO_SELECTION
): string {
	return reportPageUrl(caseId, 'report/created', rulesetId, selection);
}

/** The Report created page's download: the report's workbook and maps in a ZIP (see export/controller.ts). */
export function reportDownloadUrl(
	caseId: string,
	rulesetId: string,
	selection: ConsulteeSelection = NO_SELECTION
): string {
	return reportPageUrl(caseId, 'report/download', rulesetId, selection);
}

/** A category's Change page - the identified consultees table under the map. */
export function consulteesUrl(
	caseId: string,
	rulesetId: string,
	category: string,
	selection: ConsulteeSelection = NO_SELECTION
): string {
	return reportPageUrl(caseId, 'report/consultees', rulesetId, selection, categoryParam(category));
}

/** The "Add a consultee" page a category page's Add consultee link opens - posts back to the same URL. */
export function addConsulteeUrl(
	caseId: string,
	rulesetId: string,
	category: string,
	selection: ConsulteeSelection = NO_SELECTION
): string {
	return reportPageUrl(caseId, 'report/consultees/add', rulesetId, selection, categoryParam(category));
}

/**
 * The consultee a Change page row's Remove link targets: a ruleset match by feature id, or a
 * hand-added consultee by its index in the `add` params.
 */
export type RemovalTarget = { matchId: string } | { addedIndex: number };

/** The "Remove consultee" form on a category page - posts back to the same URL with the reason. */
export function removeConsulteeUrl(
	caseId: string,
	rulesetId: string,
	category: string,
	target: RemovalTarget,
	selection: ConsulteeSelection = NO_SELECTION
): string {
	const targetParam =
		'matchId' in target
			? `&match=${encodeURIComponent(target.matchId)}`
			: `&added=${encodeURIComponent(String(target.addedIndex))}`;
	return reportPageUrl(caseId, 'report/consultees/remove', rulesetId, selection, categoryParam(category) + targetParam);
}

/**
 * The static map for one category's visible (non-excluded) matches, with the nearby consultees
 * added by hand (`include`) drawn as identified - consultees added by name alone
 * have no area to map.
 */
export function categoryStaticMapUrl(
	caseId: string,
	rulesetId: string,
	category: string,
	selection: ConsulteeSelection = NO_SELECTION
): string {
	let url = `/consultees/${encodeURIComponent(caseId)}/results/static-map?ruleset=${encodeURIComponent(rulesetId)}${categoryParam(category)}`;
	for (const id of excludedMatchIds(selection.removed)) {
		url += `&exclude=${encodeURIComponent(id)}`;
	}
	for (const add of selection.adds) {
		if (add.id && add.category === category) {
			url += `&include=${encodeURIComponent(add.id)}`;
		}
	}
	return url;
}
