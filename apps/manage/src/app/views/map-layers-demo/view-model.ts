export interface MapLayersDemoViewModel {
	pageHeading: string;
	mapId: string;
	mapRegionLabel: string;
	mapWidth: number;
	mapHeight: number;
	mapConfigJson: string;
	layerSummaries: { label: string; description: string }[];
}
