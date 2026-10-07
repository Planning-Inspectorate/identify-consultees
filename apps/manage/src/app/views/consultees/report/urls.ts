/**
 * The consultee selections the report pages carry in their URLs. There's no server-side state:
 * which consultee areas the user removed (via a category's Change page) lives in the `exclude`
 * query params, so the check page's counts, the category page's rows and the maps drawn from the
 * same URL always agree.
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

function appendExcludes(url: string, excluded: ReadonlySet<string>): string {
	for (const id of excluded) {
		url += `&exclude=${encodeURIComponent(id)}`;
	}
	return url;
}

/** The report check page ("Preview report" destination) for a boundary/ruleset/exclusion set. */
export function reportUrl(caseId: string, rulesetId: string, excluded: ReadonlySet<string> = new Set()): string {
	return appendExcludes(
		`/consultees/${encodeURIComponent(caseId)}/report?ruleset=${encodeURIComponent(rulesetId)}`,
		excluded
	);
}

/** The "Report created" confirmation page the check page's Generate report leads to. */
export function reportCreatedUrl(caseId: string, rulesetId: string, excluded: ReadonlySet<string> = new Set()): string {
	return appendExcludes(
		`/consultees/${encodeURIComponent(caseId)}/report/created?ruleset=${encodeURIComponent(rulesetId)}`,
		excluded
	);
}

/** The category's Change page - the identified consultees table under the map. */
export function consulteesUrl(
	caseId: string,
	rulesetId: string,
	category: string,
	excluded: ReadonlySet<string> = new Set()
): string {
	return appendExcludes(
		`/consultees/${encodeURIComponent(caseId)}/report/consultees?ruleset=${encodeURIComponent(rulesetId)}&category=${encodeURIComponent(category)}`,
		excluded
	);
}

/** The static map for one category's visible (non-excluded) matches only. */
export function categoryStaticMapUrl(
	caseId: string,
	rulesetId: string,
	category: string,
	excluded: ReadonlySet<string> = new Set()
): string {
	return appendExcludes(
		`/consultees/${encodeURIComponent(caseId)}/results/static-map?ruleset=${encodeURIComponent(rulesetId)}&category=${encodeURIComponent(category)}`,
		excluded
	);
}
