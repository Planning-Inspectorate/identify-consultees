/**
 * The consultee selections the report pages carry in their URLs. There's no server-side state:
 * which consultee areas the user removed (via a category's Change page) lives in the `exclude`
 * query params, and consultees added by hand live in repeated `add` params, so the check page's
 * counts, the category page's rows and the maps drawn from the same URL always agree.
 */

/** Every value of a possibly-repeated query param (`?exclude=a&exclude=b` parses to an array). */
export function queryValues(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === 'string' && item !== '');
	}
	return typeof value === 'string' && value !== '' ? [value] : [];
}

/** The excluded consultee_area ids on the request, as a Set for `has()` lookups. */
export function excludedIds(value: unknown): Set<string> {
	return new Set(queryValues(value));
}

/** A consultee added by hand on a category's Change page - a table row, not a map feature. */
export interface AddedConsultee {
	/** The ruleset category it was added under - the page and check-page count it belongs to. */
	category: string;
	name: string;
	/** Why it was identified, shown in the Identified column. */
	reason: string;
}

/**
 * The manually-added consultees on the request: each `add` param is a small JSON object
 * (`{"c":category,"n":name,"r":reason}`) - one param per entry so they can't drift out of step,
 * and encoded JSON so any name/reason text survives a query string unambiguously. Malformed or
 * incomplete entries are ignored rather than failing the page.
 */
export function addedConsultees(value: unknown): AddedConsultee[] {
	return queryValues(value).flatMap((raw) => {
		try {
			const parsed = JSON.parse(raw) as { c?: unknown; n?: unknown; r?: unknown };
			if (typeof parsed.c !== 'string' || parsed.c === '' || typeof parsed.n !== 'string' || parsed.n === '') {
				return [];
			}
			return [{ category: parsed.c, name: parsed.n, reason: typeof parsed.r === 'string' ? parsed.r : '' }];
		} catch {
			return [];
		}
	});
}

function encodeAdd(consultee: AddedConsultee): string {
	return JSON.stringify({ c: consultee.category, n: consultee.name, r: consultee.reason });
}

/**
 * The consultee-selection state a report URL carries: excluded match ids and manually-added
 * consultees, in page order. Every report-page URL builder takes the same shape so state can't
 * be dropped by passing a link through the wrong helper.
 */
export interface ConsulteeSelection {
	excluded: ReadonlySet<string>;
	adds: readonly AddedConsultee[];
}

/** No removals and no additions - the selection the map page's links carry. */
const NO_SELECTION: ConsulteeSelection = { excluded: new Set(), adds: [] };

function appendSelection(url: string, selection: ConsulteeSelection): string {
	for (const id of selection.excluded) {
		url += `&exclude=${encodeURIComponent(id)}`;
	}
	for (const add of selection.adds) {
		url += `&add=${encodeURIComponent(encodeAdd(add))}`;
	}
	return url;
}

/** The report check page ("Preview report" destination) for a boundary/ruleset/selection. */
export function reportUrl(caseId: string, rulesetId: string, selection: ConsulteeSelection = NO_SELECTION): string {
	return appendSelection(
		`/consultees/${encodeURIComponent(caseId)}/report?ruleset=${encodeURIComponent(rulesetId)}`,
		selection
	);
}

/** The "Report created" confirmation page the check page's Generate report leads to. */
export function reportCreatedUrl(
	caseId: string,
	rulesetId: string,
	selection: ConsulteeSelection = NO_SELECTION
): string {
	return appendSelection(
		`/consultees/${encodeURIComponent(caseId)}/report/created?ruleset=${encodeURIComponent(rulesetId)}`,
		selection
	);
}

/** A category's Change page - the identified consultees table under the map. */
export function consulteesUrl(
	caseId: string,
	rulesetId: string,
	category: string,
	selection: ConsulteeSelection = NO_SELECTION
): string {
	return appendSelection(
		`/consultees/${encodeURIComponent(caseId)}/report/consultees?ruleset=${encodeURIComponent(rulesetId)}&category=${encodeURIComponent(category)}`,
		selection
	);
}

/** The "Select a consultee" form on a category page - posts back to the same URL. */
export function addConsulteeUrl(
	caseId: string,
	rulesetId: string,
	category: string,
	selection: ConsulteeSelection = NO_SELECTION
): string {
	return appendSelection(
		`/consultees/${encodeURIComponent(caseId)}/report/consultees/add?ruleset=${encodeURIComponent(rulesetId)}&category=${encodeURIComponent(category)}`,
		selection
	);
}

/** The static map for one category's visible (non-excluded) matches - manual adds aren't mapped. */
export function categoryStaticMapUrl(
	caseId: string,
	rulesetId: string,
	category: string,
	selection: ConsulteeSelection = NO_SELECTION
): string {
	let url = `/consultees/${encodeURIComponent(caseId)}/results/static-map?ruleset=${encodeURIComponent(rulesetId)}&category=${encodeURIComponent(category)}`;
	for (const id of selection.excluded) {
		url += `&exclude=${encodeURIComponent(id)}`;
	}
	return url;
}
