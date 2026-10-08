export interface ConsulteeRow {
	/** The consultee's name (e.g. the council or authority), fallback "Unnamed consultee". */
	name: string;
	/**
	 * Every reason the consultee was identified, one per line - the ruleset conditions it met and/or
	 * the general nearby search (see reasons.ts), or for one added by hand, the reason given
	 * ("Manually added" when none was).
	 */
	identified: string[];
	/**
	 * Reloads this page with the consultee removed: a match joins the exclusion set, a
	 * hand-added consultee loses its `add` param.
	 */
	removeUrl: string;
}

export interface ReportConsulteesViewModel {
	/** The category name - the page's h1; the case name sits above it as a caption. */
	pageHeading: string;
	pageCaption: string;
	backLinkUrl: string;
	rows: ConsulteeRow[];
	/** The "Select a consultee" form for adding a consultee to this category by hand. */
	addConsulteeUrl: string;
	/** Back to the check page, carrying the current exclusions. */
	saveAndReturnUrl: string;
	mapId: string;
	mapRegionLabel: string;
	staticMapSrc: string;
	staticMapAlt: string;
	mapWidth: number;
	mapHeight: number;
	mapConfigJson: string;
	/** True when the ruleset couldn't be run at all - the page shows an error, not an empty list. */
	rulesetFailed: boolean;
	retryUrl: string;
	/** Total matches the ruleset found in this category - may exceed what the map draws. */
	matchCount: number;
	mapIsSampled: boolean;
	mapSampleSize: number;
}
