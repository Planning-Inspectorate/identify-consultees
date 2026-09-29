export interface ConsulteesResultsViewModel {
	pageHeading: string;
	backLinkUrl: string;
	backLinkText: string;
	rulesetLabel: string;
	reference: string;
	caseName: string;
	geometryId: string;
	downloadSummaryHref: string;
	downloadMapsHref: string;
	sections: ConsulteeMapSection[];
	// only present for a real project (from case_boundary, not the dummy prototype data) - a
	// genuine spatial query result, not a demo. See buildConsulteesResultsPage.
	realScreening?: RealScreeningResult;
}

export interface RealScreeningRow {
	consultee: string | null;
	region: string | null;
	distanceMetres: number;
}

export interface RealScreeningResult {
	heading: string;
	rows: RealScreeningRow[];
}

export interface ConsulteeMapSection {
	id: string;
	heading: string;
	mapTitle: string;
	mapRegionLabel: string;
	consultees: string[];
	staticMapSrc: string;
	staticMapAlt: string;
	mapWidth: number;
	mapHeight: number;
	mapConfigJson: string;
}
