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
