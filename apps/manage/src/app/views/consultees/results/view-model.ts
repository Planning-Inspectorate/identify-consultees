export interface ConsulteesResultsViewModel {
	pageHeading: string;
	backLinkUrl: string;
	rulesetName: string;
	reference: string;
	caseName: string;
	caseId: string;
	mapId: string;
	mapRegionLabel: string;
	staticMapSrc: string;
	/** True when the ruleset couldn't be run at all - the page shows an error, not empty results. */
	rulesetFailed: boolean;
	retryUrl: string;
	staticMapAlt: string;
	mapWidth: number;
	mapHeight: number;
	mapConfigJson: string;
	/** Every consultee the run found - ruleset conditions and the general nearby search - with its reasons. */
	matches: ConsulteeMatchRow[];
	/** The same as matches.length, kept explicit for the map note below. */
	matchCount: number;
	/** True when the map shows only a sample of matches, not all of them - see maps/case-geojson.ts. */
	mapIsSampled: boolean;
	mapSampleSize: number;
	/** The general nearby search's radius, which the page explains. */
	nearbyRadiusKm: number;
}

export interface ConsulteeMatchRow {
	consultee: string | null;
	consulteeCategory: string | null;
	region: string | null;
	/** Every reason it was identified - see reasons.ts. */
	reasons: string[];
}
