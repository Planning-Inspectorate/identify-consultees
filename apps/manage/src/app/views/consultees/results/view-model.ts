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
}

export interface ConsulteeMatchRow {
	consultee: string | null;
	consulteeCategory: string | null;
	region: string | null;
	distanceMetres: number;
}
