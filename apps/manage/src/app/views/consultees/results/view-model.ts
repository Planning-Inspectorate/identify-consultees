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
	staticMapAlt: string;
	mapWidth: number;
	mapHeight: number;
	mapConfigJson: string;
	matches: ConsulteeMatchRow[];
	/** Total matches the ruleset found - the same as matches.length, kept explicit for the map note below. */
	matchCount: number;
	/** True when the map shows only a sample of matches, not all of them - see maps/case-geojson.ts. */
	mapIsSampled: boolean;
	mapSampleSize: number;
	/** Every consultee within nearbyRadiusKm, any category - shown by default alongside the ruleset's own matches. */
	nearbyMatches: ConsulteeMatchRow[];
	nearbyMatchCount: number;
	nearbyRadiusKm: number;
}

export interface ConsulteeMatchRow {
	consultee: string | null;
	consulteeCategory: string | null;
	region: string | null;
	distanceMetres: number;
}
