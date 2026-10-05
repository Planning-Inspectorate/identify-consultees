export interface InteractiveMapExampleListItem {
	id: string;
	title: string;
	summary: string;
	href: string;
	behaviourLabel: string;
	pluginsLabel: string;
}

export interface InteractiveMapExamplesIndexViewModel {
	pageHeading: string;
	backLinkUrl: string;
	backLinkText: string;
	examples: InteractiveMapExampleListItem[];
}

export interface InteractiveMapExampleViewModel {
	pageHeading: string;
	backLinkUrl: string;
	backLinkText: string;
	summary: string;
	interaction: string;
	mapId: string;
	mapRegionLabel: string;
	staticMapSrc: string;
	staticMapAlt: string;
	mapWidth: number;
	mapHeight: number;
	mapConfigJson: string;
	/** Public URLs for each plugin stylesheet this example needs (empty for none). */
	pluginStylesheets: string[];
	/** Public URLs for each plugin script this example needs (empty for none). */
	pluginScripts: string[];
	behaviourLabel: string;
	pluginsLabel: string;
	/**
	 * Feature details for the static fallback — rendered inside <noscript> and
	 * in a hidden block the client reveals when interactive init fails.
	 * `head`/`rows` are already in govukTable shape.
	 */
	featureLegend?: {
		heading: string;
		head: { text: string }[];
		rows: { text: string }[][];
	};
}
