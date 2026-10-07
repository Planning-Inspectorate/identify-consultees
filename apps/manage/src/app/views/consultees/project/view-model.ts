export interface ConsulteeProjectViewModel {
	/** The case name - the page's h1; the reference sits above it as a caption. */
	pageHeading: string;
	reference: string;
	caseName: string;
	caseId: string;
	backLinkUrl: string;
	/** "Back to projects" - the layout renders the back link itself from these two. */
	backLinkText: string;
	/** "Sector, Type[, Sub-type]" derived from the case reference/name - null when unknown. */
	sectorDescription: string | null;
	/** Project stage tag (e.g. Acceptance) - null when the data source doesn't carry one. */
	stage: string | null;
	/** The shapefile this page's map is drawn from. */
	shapefileName: string;
	shapefileChangeUrl: string;
	rulesetName: string;
	rulesetChangeUrl: string;
	previewReportUrl: string;
	/** POST target for "Run Intersection logic" - re-runs the ruleset and redraws the map. */
	runIntersectionUrl: string;
	/** The selected ruleset's id - posted back by the "Run Intersection logic" form. */
	rulesetId: string;
	mapId: string;
	mapRegionLabel: string;
	staticMapSrc: string;
	/** True when the ruleset couldn't be run at all - the page shows an error, not an empty map. */
	rulesetFailed: boolean;
	retryUrl: string;
	staticMapAlt: string;
	mapWidth: number;
	mapHeight: number;
	mapConfigJson: string;
	/** Total matches the ruleset found - may exceed what the map draws. */
	matchCount: number;
	/** True when the map shows only a sample of matches, not all of them - see maps/case-geojson.ts. */
	mapIsSampled: boolean;
	mapSampleSize: number;
}
