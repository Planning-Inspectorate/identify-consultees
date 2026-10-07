/**
 * Initialise Defra Interactive Maps for each consultee section on the results page.
 *
 * Pattern ported from PINS-data-spike `uploads-map.js` / `case-map.js`:
 * - datasetsPlugin + mapKeyPlugin for layers and legend
 * - OpenFreeMap Liberty basemap
 * - Static map fallback (PNG or SVG) via data-static-map-src when interactive init fails
 */

const CONSULTEE_COLOURS = ['#55A868', '#4C72B0', '#DD8452', '#8172B2', '#C44E52'];

// one per category in the "all consultees nearby" layer - none reuse the project (red) or ruleset
// match (green) colours
const NEARBY_CATEGORY_COLOURS = [
	'#1d70b8',
	'#f47738',
	'#912b88',
	'#28a197',
	'#b58840',
	'#d53880',
	'#5694ca',
	'#85994b',
	'#6f72af',
	'#505a5f'
];

const POINT_TYPES = new Set(['Point', 'MultiPoint']);

/**
 * A `#rrggbb` colour as a translucent `rgba(...)` fill. The datasets plugin has no fill-opacity
 * option - transparency has to be part of the colour, or the fill is drawn solid.
 *
 * @param {string} hex
 * @param {number} alpha
 * @returns {string}
 */
export function translucent(hex, alpha) {
	const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// a small dot, rather than the built-in 44px symbols - a site can have a hundred hospitals nearby.
// The plugin's symbol format requires the halo/selected/active colour tokens to be present (the
// ring layer is hidden unless a feature is selected), or the symbol isn't drawn at all
const SMALL_CIRCLE_SYMBOL = {
	// what makes the plugin draw a sublayer as points - the custom SVG below replaces its image
	symbol: 'circle',
	symbolSvgContent:
		'<circle cx="8" cy="8" r="7" fill="{{selectedColor}}" stroke="{{activeColor}}" stroke-width="2" paint-order="stroke fill"/>' +
		'<circle cx="8" cy="8" r="5" fill="{{backgroundColor}}" stroke="{{haloColor}}" stroke-width="2" paint-order="stroke fill"/>',
	symbolViewBox: '0 0 16 16',
	symbolAnchor: [0.5, 0.5]
};

/**
 * One sublayer per consultee category, so each can be shown or hidden from the map's layers menu.
 * Areas are drawn as outlines - regional areas (counties, police forces) overlap and would bury
 * each other if filled - and point categories (hospitals, harbours) as circles.
 *
 * @param {object[]} features
 * @returns {object[]}
 */
export function buildNearbySublayers(features) {
	const byCategory = new Map();
	for (const feature of features) {
		const category = feature.properties?.consulteeCategory || 'Other';
		const members = byCategory.get(category) ?? [];
		members.push(feature);
		byCategory.set(category, members);
	}

	return [...byCategory.keys()].sort().map((category, index) => {
		const colour = NEARBY_CATEGORY_COLOURS[index % NEARBY_CATEGORY_COLOURS.length];
		const members = byCategory.get(category);
		const isPoints = members.every((feature) => POINT_TYPES.has(feature.geometry?.type));
		return {
			id: `nearby-${index}`,
			label: `${category} (${members.length})`,
			filter: ['==', ['get', 'consulteeCategory'], category],
			style: isPoints
				? { ...SMALL_CIRCLE_SYMBOL, symbolBackgroundColor: colour }
				: { stroke: colour, strokeWidth: 2, fill: 'transparent' }
		};
	});
}

/**
 * @param {string} mapId
 * @returns {object | null}
 */
export function readMapConfig(mapId) {
	const el = document.getElementById(`${mapId}-data`);
	if (!(el instanceof HTMLScriptElement)) {
		return null;
	}

	try {
		return JSON.parse(el.text || el.textContent || '');
	} catch {
		return null;
	}
}

/**
 * @param {HTMLElement} container
 */
export function showStaticMapFallback(container) {
	if (container.querySelector('.app-case-map-static')) {
		return;
	}

	const src = container.dataset.staticMapSrc;
	const alt = container.dataset.staticMapAlt ?? '';
	if (!src) {
		container.textContent =
			'The interactive map could not load. See the consultee list below for the identified organisations.';
		return;
	}

	const width = Number(container.dataset.mapWidth) || 960;
	const height = Number(container.dataset.mapHeight) || 516;

	const img = document.createElement('img');
	img.className = 'app-case-map-static';
	img.src = src;
	img.alt = alt;
	img.width = width;
	img.height = height;

	const hint = document.createElement('p');
	hint.className = 'govuk-body app-case-map-js-hint';
	hint.textContent =
		'The interactive map could not load. A static map of the same project site and consultee areas is shown instead.';

	container.replaceChildren(img);
	container.classList.remove('app-case-map-interactive');
	container.insertAdjacentElement('afterend', hint);
}

/**
 * @param {object} config
 * @returns {object[]}
 */
export function buildDatasets(config) {
	const datasets = [];

	// datasets draw in order, so the search area and the nearby consultees go under the project
	// site and the ruleset's matches
	if (config.searchAreaGeojson?.features?.length > 0) {
		datasets.push({
			id: 'search-area',
			label: config.searchAreaLabel ?? 'Search area',
			geojson: config.searchAreaGeojson,
			minZoom: 0,
			maxZoom: 24,
			showInKey: true,
			showInMenu: true,
			style: { stroke: '#0b0c0c', strokeWidth: 2, strokeDashArray: [4, 3], fill: 'transparent' }
		});
	}

	if (config.nearbyGeojson?.features?.length > 0) {
		datasets.push({
			id: 'nearby-consultees',
			label: config.nearbyLayerLabel ?? 'All consultees nearby',
			geojson: config.nearbyGeojson,
			minZoom: 0,
			maxZoom: 24,
			showInKey: true,
			showInMenu: true,
			style: { stroke: '#505a5f', strokeWidth: 2, fill: 'transparent' },
			sublayers: buildNearbySublayers(config.nearbyGeojson.features)
		});
	}

	if (config.projectGeojson?.features?.length > 0) {
		datasets.push({
			id: 'project-site',
			label: config.projectLayerLabel ?? 'Project site',
			geojson: config.projectGeojson,
			minZoom: 0,
			maxZoom: 24,
			showInKey: true,
			showInMenu: true,
			style: {
				stroke: '#C44E52',
				fill: translucent('#C44E52', 0.45)
			}
		});
	}

	if (config.consulteeGeojson?.features?.length > 0) {
		const colour = CONSULTEE_COLOURS[0];
		datasets.push({
			id: 'consultee-areas',
			label: config.consulteeLayerLabel ?? 'Consultee areas',
			geojson: config.consulteeGeojson,
			minZoom: 0,
			maxZoom: 24,
			showInKey: true,
			showInMenu: true,
			// a very light fill: the site's council, parish, police force and so on all cover the
			// same ground, and their fills stack - the outlines carry the layer
			style: {
				stroke: colour,
				strokeWidth: 3,
				fill: translucent(colour, 0.05)
			}
		});
	}

	return datasets;
}

/**
 * @param {string} mapId
 */
export function initConsulteeMap(mapId) {
	const config = readMapConfig(mapId);
	const container = document.getElementById(mapId);
	if (!container) {
		return;
	}

	const defra = window.defra;
	if (!config || !defra?.InteractiveMap || !defra.maplibreProvider) {
		showStaticMapFallback(container);
		return;
	}

	container.replaceChildren();
	container.classList.add('app-case-map-interactive');

	try {
		const datasetsPlugin = defra.datasetsPlugin({ datasets: buildDatasets(config) });
		const mapKeyPlugin = defra.mapKeyPlugin();

		void new defra.InteractiveMap(mapId, {
			behaviour: 'inline',
			mapProvider: defra.maplibreProvider(),
			mapStyle: {
				url: 'https://tiles.openfreemap.org/styles/liberty',
				attribution: 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
				backgroundColor: '#f5f5f0'
			},
			center: config.center,
			zoom: config.zoom,
			containerHeight: `${config.height ?? 516}px`,
			mapLabel: config.mapLabel,
			plugins: [datasetsPlugin, mapKeyPlugin]
		});
	} catch {
		showStaticMapFallback(container);
	}
}

export function initAllConsulteeMaps() {
	const containers = document.querySelectorAll('[data-consultee-map]');
	for (const container of containers) {
		if (container instanceof HTMLElement && container.id) {
			initConsulteeMap(container.id);
		}
	}
}

/**
 * @param {Document | undefined} documentTarget
 */
export function registerConsulteeMaps(documentTarget = globalThis.document) {
	if (!documentTarget) {
		return;
	}

	if (documentTarget.readyState === 'loading') {
		documentTarget.addEventListener('DOMContentLoaded', initAllConsulteeMaps);
		return;
	}

	initAllConsulteeMaps();
}

registerConsulteeMaps();
