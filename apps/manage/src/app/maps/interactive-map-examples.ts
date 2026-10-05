/**
 * Registry of worked examples for the Defra Interactive Map component,
 * rendered on the hidden `/components/interactive-map` showcase pages.
 *
 * Each example carries:
 * - the plugin bundles its page must load (`plugins`)
 * - a serialisable `clientConfig` consumed by `interactive-map-examples.js`
 * - the GeoJSON + alt text for the server-rendered static fallback
 *   (no-JavaScript / map-init-failure experience)
 *
 * Demo geography follows the upstream Defra documentation examples
 * (Ambleside / Windermere field parcels and monuments).
 */

import { FIELD_PARCELS_GEOJSON, HISTORIC_MONUMENTS_GEOJSON } from './interactive-map-examples-data.ts';
import type { GeoJsonFeature, GeoJsonFeatureCollection } from './sample-geojson.ts';
import { centroidOfGeometry, type LngLat } from './static-map.ts';

export const INTERACTIVE_MAP_OPENFREEMAP_ATTRIBUTION = 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap';
export const INTERACTIVE_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const MAP_BACKGROUND = '#f5f5f0';

export type InteractiveMapPluginId = 'datasets' | 'map-key' | 'interact' | 'draw' | 'map-styles';

export type InteractiveMapExampleKind =
	| 'basic'
	| 'button-first'
	| 'polygons'
	| 'symbols'
	| 'marker-panel'
	| 'marker-label'
	| 'place-marker'
	| 'select-feature'
	| 'draw-tools'
	| 'style-switcher';

/**
 * Serialisable per-example config embedded in the page as JSON for
 * `src/public/javascripts/interactive-map-examples.js`. `kind` selects the
 * wiring; the rest are plain options passed through to plugins/map init.
 */
export interface InteractiveMapExampleConfig {
	kind: InteractiveMapExampleKind;
	behaviour: 'inline' | 'buttonFirst' | 'hybrid';
	/** Shows the built-in Exit button when the map is fullscreen (buttonFirst/hybrid). */
	hasExitButton?: boolean;
	center: [number, number];
	zoom: number;
	height: number;
	mapLabel: string;
	datasets?: Record<string, unknown>[];
	interact?: Record<string, unknown>;
	draw?: Record<string, unknown>;
	mapKey?: boolean;
	mapStyles?: Record<string, unknown>[];
	marker?: Record<string, unknown>;
	markers?: Record<string, unknown>[];
	panel?: Record<string, unknown>;
	backAndContinue?: Record<string, unknown>;
}

export interface InteractiveMapExample {
	id: InteractiveMapExampleKind;
	title: string;
	/** Description shown above the map — doubles as the text alternative for the visual content. */
	summary: string;
	/** "Try this" hint rendered as inset text on the example page. */
	interaction: string;
	/** Vendor plugin bundles (besides core + provider) the page loads. */
	plugins: InteractiveMapPluginId[];
	clientConfig: InteractiveMapExampleConfig;
	/** Server-rendered static fallback inputs (GeoJSON overlays + alt text). */
	staticMap: {
		projectGeojson: GeoJsonFeatureCollection;
		consulteeGeojson: GeoJsonFeatureCollection;
		alt: string;
		/** Pin glyphs for marker-style examples. */
		markers?: { coords: LngLat; label?: string }[];
		/** Numbered badges tying map features to the legend rows below the image. */
		featureBadges?: { coords: LngLat; label: string; fill?: string }[];
		/** Feature details listed under the map for no-JS / init-failure users. */
		legend?: {
			heading: string;
			columns: string[];
			rows: string[][];
		};
	};
}

const EMPTY_COLLECTION: GeoJsonFeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * Stylised 60x60 basemap swatch for the style-switcher thumbnails, served as a
 * data URI so the decorative preview costs no request. Colours loosely match
 * each OpenFreeMap style's palette.
 */
function mapStyleThumbnail(palette: { background: string; water: string; green: string; road: string }): string {
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">` +
		`<rect width="60" height="60" fill="${palette.background}"/>` +
		`<path d="M0 0h60v14C42 24 20 10 0 20Z" fill="${palette.water}"/>` +
		`<circle cx="15" cy="45" r="10" fill="${palette.green}"/>` +
		`<rect x="38" y="36" width="11" height="9" fill="${palette.road}" opacity="0.85"/>` +
		`<path d="M0 58C18 50 38 46 60 48" stroke="${palette.road}" stroke-width="4" fill="none"/>` +
		`<path d="M44 60L52 24" stroke="${palette.road}" stroke-width="3" fill="none"/>` +
		`</svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const AMBLESIDE_CENTER: [number, number] = [-2.464, 54.558];
const WINDERMERE_MARKER: [number, number] = [-2.96, 54.43];
const DORSET_CENTER: [number, number] = [-1.78, 50.62];
const DEFAULT_HEIGHT = 516;

const FIELD_PARCELS_STYLE = {
	stroke: '#1d70b8',
	strokeWidth: 2,
	fill: '#1d70b8',
	fillOpacity: 0.4
};

/** SVG path used as the square symbol graphic in the upstream symbols example. */
const MONUMENT_SYMBOL_GRAPHIC = 'M3 15H1V1h2v2h2V1h2v5h2V4h2v2h2V4h2v11H6V9H3v6z';

const FIELD_PARCELS_DATASET = {
	id: 'field-parcels',
	label: 'Field parcels',
	geojson: FIELD_PARCELS_GEOJSON,
	minZoom: 10,
	maxZoom: 24,
	showInKey: true,
	showInMenu: true,
	style: FIELD_PARCELS_STYLE
};

const MONUMENT_SUBLAYER_COLOURS: Record<string, string> = {
	prehistoric: '#00897B',
	roman: '#ca3535',
	medieval: '#1565C0'
};

/** Numbered badges positioned at each feature's centroid (or the point itself). Exported for tests. */
export function numberedBadges(
	features: GeoJsonFeature[],
	fillBy?: (feature: GeoJsonFeature) => string | undefined
): { coords: LngLat; label: string; fill?: string }[] {
	return features.flatMap((feature, i) => {
		const coords = centroidOfGeometry(feature.geometry);
		return coords ? [{ coords, label: String(i + 1), fill: fillBy?.(feature) }] : [];
	});
}

function capitalise(value: string): string {
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function monumentSublayers() {
	return (Object.keys(MONUMENT_SUBLAYER_COLOURS) as (keyof typeof MONUMENT_SUBLAYER_COLOURS)[]).map((category) => ({
		id: category,
		label: capitalise(category),
		filter: ['in', ['get', 'category'], category],
		style: {
			symbol: 'square',
			symbolGraphic: MONUMENT_SYMBOL_GRAPHIC,
			symbolBackgroundColor: MONUMENT_SUBLAYER_COLOURS[category]
		}
	}));
}

export const INTERACTIVE_MAP_EXAMPLES: readonly InteractiveMapExample[] = [
	{
		id: 'basic',
		title: 'Basic map',
		summary: 'A minimal inline map on the default OpenFreeMap basemap. No plugins or overlays — just pan and zoom.',
		interaction: 'Pan with the mouse or arrow keys, zoom with the controls or +/- keys.',
		plugins: [],
		clientConfig: {
			kind: 'basic',
			behaviour: 'inline',
			center: DORSET_CENTER,
			zoom: 11,
			height: DEFAULT_HEIGHT,
			mapLabel: 'Map of the Dorset coast around the demo project site'
		},
		staticMap: {
			projectGeojson: EMPTY_COLLECTION,
			consulteeGeojson: EMPTY_COLLECTION,
			alt: 'Static map of the Dorset coast centred on the demo project site.'
		}
	},
	{
		id: 'button-first',
		title: 'Button-first map',
		summary:
			'The interactive map starts collapsed behind a "Map view" button. Activating it opens the map ' +
			'fullscreen — the recommended pattern for low-resource devices and keyboard users. Without ' +
			'JavaScript only the static map below is shown.',
		interaction: 'Activate the Map view button to open the map, then use the Exit button to leave it.',
		plugins: [],
		clientConfig: {
			kind: 'button-first',
			behaviour: 'buttonFirst',
			hasExitButton: true,
			center: DORSET_CENTER,
			zoom: 11,
			height: DEFAULT_HEIGHT,
			mapLabel: 'Map of the Dorset coast around the demo project site'
		},
		staticMap: {
			projectGeojson: EMPTY_COLLECTION,
			consulteeGeojson: EMPTY_COLLECTION,
			alt: 'Static map of the Dorset coast centred on the demo project site.'
		}
	},
	{
		id: 'polygons',
		title: 'Polygon overlay',
		summary:
			'Seven demo field parcels near Ambleside drawn as a filled GeoJSON dataset via the datasets plugin, ' +
			'with the map-key plugin providing a legend.',
		interaction: 'Open the Key panel to see the layer entry; zoom in to inspect individual parcels.',
		plugins: ['datasets', 'map-key'],
		clientConfig: {
			kind: 'polygons',
			behaviour: 'inline',
			center: AMBLESIDE_CENTER,
			zoom: 14,
			height: DEFAULT_HEIGHT,
			mapLabel: 'Map showing field parcel polygons near Ambleside',
			mapKey: true,
			datasets: [FIELD_PARCELS_DATASET]
		},
		staticMap: {
			projectGeojson: FIELD_PARCELS_GEOJSON,
			consulteeGeojson: EMPTY_COLLECTION,
			alt: 'Static map of seven field parcel polygons near Ambleside in the Lake District.'
		}
	},
	{
		id: 'symbols',
		title: 'Symbol layer',
		summary:
			'Historic monument points categorised by period — prehistoric, Roman and medieval — each shown with a ' +
			'distinct coloured symbol using datasets sublayers.',
		interaction: 'Each symbol colour represents a different period; use the Key panel for the legend.',
		plugins: ['datasets', 'map-key'],
		clientConfig: {
			kind: 'symbols',
			behaviour: 'inline',
			center: AMBLESIDE_CENTER,
			zoom: 14,
			height: DEFAULT_HEIGHT,
			mapLabel: 'Map showing historic monument symbols near Ambleside',
			mapKey: true,
			datasets: [
				{
					id: 'historic-monuments',
					label: 'Historic monuments',
					geojson: HISTORIC_MONUMENTS_GEOJSON,
					minZoom: 10,
					maxZoom: 24,
					showInKey: true,
					showInMenu: true,
					sublayers: monumentSublayers()
				}
			]
		},
		staticMap: {
			projectGeojson: EMPTY_COLLECTION,
			consulteeGeojson: EMPTY_COLLECTION,
			alt: 'Static map of the Ambleside area where prehistoric, Roman and medieval monument points are marked.',
			featureBadges: numberedBadges(
				HISTORIC_MONUMENTS_GEOJSON.features,
				(feature) => MONUMENT_SUBLAYER_COLOURS[String(feature.properties.category)]
			),
			legend: {
				heading: 'Monuments shown on the map',
				columns: ['Number', 'Name', 'Period'],
				rows: HISTORIC_MONUMENTS_GEOJSON.features.map((feature, i) => [
					String(i + 1),
					String(feature.properties.name),
					capitalise(String(feature.properties.category))
				])
			}
		}
	},
	{
		id: 'marker-panel',
		title: 'Marker with info panel',
		summary:
			'A selectable marker that opens an information panel when activated — the pattern for "click a point ' +
			'to see details" interactions.',
		interaction: 'Select the marker to open the details panel; dismiss it or click away to close.',
		plugins: ['interact'],
		clientConfig: {
			kind: 'marker-panel',
			behaviour: 'inline',
			center: WINDERMERE_MARKER,
			zoom: 14,
			height: DEFAULT_HEIGHT,
			mapLabel: 'Map with a selectable marker near Windermere',
			interact: { deselectOnClickOutside: true },
			marker: { id: 'demo-marker', coords: WINDERMERE_MARKER },
			panel: {
				id: 'marker-info',
				label: 'Marker details',
				property: 'name',
				fallback: 'Demo marker near Windermere'
			}
		},
		staticMap: {
			projectGeojson: EMPTY_COLLECTION,
			consulteeGeojson: EMPTY_COLLECTION,
			alt: 'Static map centred on the marker location near Windermere.',
			markers: [{ coords: WINDERMERE_MARKER, label: 'Demo marker' }],
			legend: {
				heading: 'Marker details',
				columns: ['Details'],
				rows: [['Demo marker near Windermere']]
			}
		}
	},
	{
		id: 'marker-label',
		title: 'Toggle marker label',
		summary:
			'A marker whose text label appears only when the marker is selected — keeps dense maps readable while ' +
			'still exposing names on demand.',
		interaction: 'Select the marker to reveal its label; click away to hide it again.',
		plugins: ['interact'],
		clientConfig: {
			kind: 'marker-label',
			behaviour: 'inline',
			center: WINDERMERE_MARKER,
			zoom: 14,
			height: DEFAULT_HEIGHT,
			mapLabel: 'Map with a labelled marker near Windermere',
			interact: { deselectOnClickOutside: true },
			marker: { id: 'demo-marker', coords: WINDERMERE_MARKER, label: 'Demo location', showLabel: false }
		},
		staticMap: {
			projectGeojson: EMPTY_COLLECTION,
			consulteeGeojson: EMPTY_COLLECTION,
			alt: 'Static map centred on the labelled marker near Windermere.',
			markers: [{ coords: WINDERMERE_MARKER, label: 'Demo location' }],
			legend: {
				heading: 'Marker details',
				columns: ['Details'],
				rows: [['Demo location — near Windermere']]
			}
		}
	},
	{
		id: 'place-marker',
		title: 'Place marker (hybrid)',
		summary:
			'Hybrid behaviour: the map shows inline but can expand, and on mobile it opens fullscreen with Back and ' +
			'Continue buttons. Continue only enables once a location pin has been placed.',
		interaction: 'Open the map and click to drop a location pin; the Continue button enables once placed.',
		plugins: ['interact'],
		clientConfig: {
			kind: 'place-marker',
			behaviour: 'hybrid',
			center: WINDERMERE_MARKER,
			zoom: 13,
			height: DEFAULT_HEIGHT,
			mapLabel: 'Map for placing a location marker near Windermere',
			interact: { interactionModes: ['placeMarker'] },
			backAndContinue: {
				backLabel: 'Back',
				continueLabel: 'Continue',
				requireMarkerId: 'location'
			}
		},
		staticMap: {
			projectGeojson: EMPTY_COLLECTION,
			consulteeGeojson: EMPTY_COLLECTION,
			alt: 'Static map centred on Windermere where a location pin can be placed.'
		}
	},
	{
		id: 'select-feature',
		title: 'Select a feature',
		summary:
			'Feature selection on the field parcels dataset — selecting a polygon opens a panel showing its name and ' +
			'land use. Demonstrates the interact plugin selectFeature mode.',
		interaction: 'Click a field parcel to select it and see its details in the panel.',
		plugins: ['datasets', 'interact'],
		clientConfig: {
			kind: 'select-feature',
			behaviour: 'inline',
			center: AMBLESIDE_CENTER,
			zoom: 14,
			height: DEFAULT_HEIGHT,
			mapLabel: 'Map with selectable field parcels near Ambleside',
			datasets: [FIELD_PARCELS_DATASET],
			interact: {
				interactionModes: ['selectFeature'],
				deselectOnClickOutside: true,
				layers: [{ layerId: 'field-parcels', idProperty: 'name' }]
			},
			panel: {
				id: 'parcel-info',
				label: 'Selected parcel',
				property: 'name',
				detailProperty: 'landUse',
				detailLabel: 'Land use',
				fallback: 'Selected parcel'
			}
		},
		staticMap: {
			projectGeojson: FIELD_PARCELS_GEOJSON,
			consulteeGeojson: EMPTY_COLLECTION,
			alt: 'Static map of selectable field parcel polygons near Ambleside.',
			featureBadges: numberedBadges(FIELD_PARCELS_GEOJSON.features),
			legend: {
				heading: 'Parcels shown on the map',
				columns: ['Number', 'Name', 'Land use'],
				rows: FIELD_PARCELS_GEOJSON.features.map((feature, i) => [
					String(i + 1),
					String(feature.properties.name),
					String(feature.properties.landUse)
				])
			}
		}
	},
	{
		id: 'draw-tools',
		title: 'Draw tools',
		summary:
			'Polygon drawing tools with vertex snapping to the field parcels layer, plus multi-select on the drawn ' +
			'shapes. Demonstrates the draw and interact plugins together.',
		interaction: 'Use the draw controls to sketch a polygon — vertices snap to parcel boundaries.',
		plugins: ['datasets', 'interact', 'draw'],
		clientConfig: {
			kind: 'draw-tools',
			behaviour: 'inline',
			center: AMBLESIDE_CENTER,
			zoom: 14,
			height: DEFAULT_HEIGHT,
			mapLabel: 'Map with polygon draw tools near Ambleside',
			datasets: [FIELD_PARCELS_DATASET],
			interact: {
				interactionModes: ['selectFeature'],
				multiSelect: true,
				deselectOnClickOutside: true,
				layers: [
					{ layerId: 'fill-inactive.cold', idProperty: 'id' },
					{ layerId: 'stroke-inactive.cold', idProperty: 'id' }
				]
			},
			draw: { snapLayers: ['field-parcels'] }
		},
		staticMap: {
			projectGeojson: FIELD_PARCELS_GEOJSON,
			consulteeGeojson: EMPTY_COLLECTION,
			alt: 'Static map of the field parcels used as snapping targets for the draw tools.'
		}
	},
	{
		id: 'style-switcher',
		title: 'Basemap style switcher',
		summary:
			'The map-styles plugin lets users swap between OpenFreeMap basemap styles — including light and dark ' +
			'variants — from a control on the map.',
		interaction: 'Use the styles control on the map to switch between the available basemaps.',
		plugins: ['map-styles'],
		clientConfig: {
			kind: 'style-switcher',
			behaviour: 'inline',
			center: DORSET_CENTER,
			zoom: 10,
			height: DEFAULT_HEIGHT,
			mapLabel: 'Map with a basemap style switcher over the Dorset coast',
			mapStyles: [
				{
					id: 'liberty',
					label: 'Liberty',
					url: 'https://tiles.openfreemap.org/styles/liberty',
					attribution: INTERACTIVE_MAP_OPENFREEMAP_ATTRIBUTION,
					backgroundColor: MAP_BACKGROUND,
					thumbnail: mapStyleThumbnail({
						background: '#f8f4f0',
						water: '#9ec8ee',
						green: '#a8d598',
						road: '#f0b84f'
					})
				},
				{
					id: 'positron',
					label: 'Positron',
					url: 'https://tiles.openfreemap.org/styles/positron',
					attribution: INTERACTIVE_MAP_OPENFREEMAP_ATTRIBUTION,
					backgroundColor: MAP_BACKGROUND,
					thumbnail: mapStyleThumbnail({
						background: '#fafaf7',
						water: '#d9e8f3',
						green: '#e6eadf',
						road: '#d5d0c8'
					})
				},
				{
					id: 'bright',
					label: 'Bright',
					url: 'https://tiles.openfreemap.org/styles/bright',
					attribution: INTERACTIVE_MAP_OPENFREEMAP_ATTRIBUTION,
					backgroundColor: MAP_BACKGROUND,
					thumbnail: mapStyleThumbnail({
						background: '#f8f4f0',
						water: '#58b4f2',
						green: '#92d088',
						road: '#f8a83c'
					})
				},
				{
					id: 'dark',
					label: 'Dark',
					url: 'https://tiles.openfreemap.org/styles/dark',
					attribution: INTERACTIVE_MAP_OPENFREEMAP_ATTRIBUTION,
					backgroundColor: '#0b0c0c',
					mapColorScheme: 'dark',
					appColorScheme: 'dark',
					thumbnail: mapStyleThumbnail({
						background: '#1a1b1b',
						water: '#2b3d52',
						green: '#243a2c',
						road: '#4c5555'
					})
				}
			]
		},
		staticMap: {
			projectGeojson: EMPTY_COLLECTION,
			consulteeGeojson: EMPTY_COLLECTION,
			alt: 'Static map of the Dorset coast on the default Liberty basemap style.'
		}
	}
];

export function getInteractiveMapExample(id: string): InteractiveMapExample | undefined {
	return INTERACTIVE_MAP_EXAMPLES.find((example) => example.id === id);
}
