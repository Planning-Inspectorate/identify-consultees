export interface ConsulteeRow {
	/** The consultee area's name (e.g. the council or authority), fallback "Unnamed consultee". */
	name: string;
	/** How the ruleset identified it - "Within 1km buffer", "Intersects the site", bordering text. */
	identified: string;
	/** Reloads this page with the consultee added to the exclusion set. */
	removeUrl: string;
}

export interface ReportConsulteesViewModel {
	/** The category name - the page's h1; the case name sits above it as a caption. */
	pageHeading: string;
	pageCaption: string;
	backLinkUrl: string;
	rows: ConsulteeRow[];
	/** Placeholder until "add a consultee" exists. */
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
