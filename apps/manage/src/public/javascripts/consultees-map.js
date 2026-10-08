/**
 * Initialise Defra Interactive Maps for each consultee section on the results page.
 *
 * Pattern ported from PINS-data-spike `uploads-map.js` / `case-map.js`:
 * - datasetsPlugin + mapKeyPlugin for layers and legend
 * - OpenFreeMap Liberty basemap
 * - Static map fallback (PNG or SVG) via `config.fallback` when interactive init fails.
 *   Fallback details travel in the page's JSON config, not data-* attributes - the
 *   InteractiveMap constructor JSON.parses every data-* attribute on its container.
 */

// consultee features carry their category colour (`colour`), assigned server-side so the static map
// matches - see app/maps/category-colours.ts. This is only for features without one
const DEFAULT_CONSULTEE_COLOUR = '#55A868';

// each consultee also carries its fill opacity (`fillOpacity`) - regional areas are only tinted
const DEFAULT_FILL_OPACITY = 0.35;

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
 * One sublayer per consultee category, in the category's colour, so each can be shown or hidden
 * from the map's layers menu. Points (hospitals, harbours) are drawn as small dots; areas are
 * filled at the category's `fillOpacity`, lightest first so the regional tints sit under the local
 * areas.
 *
 * @param {object[]} features
 * @param {string} idPrefix
 * @returns {object[]}
 */
export function buildCategorySublayers(features, idPrefix) {
	const byCategory = new Map();
	for (const feature of features) {
		const category = feature.properties?.consulteeCategory || 'Other';
		const members = byCategory.get(category) ?? [];
		members.push(feature);
		byCategory.set(category, members);
	}

	const categories = [...byCategory.keys()].sort().map((category) => {
		const members = byCategory.get(category);
		return { category, members, opacity: Number(members[0].properties?.fillOpacity) || DEFAULT_FILL_OPACITY };
	});
	// sublayers draw in order
	categories.sort((a, b) => a.opacity - b.opacity);

	return categories.map(({ category, members, opacity }, index) => {
		const colour = members[0].properties?.colour || DEFAULT_CONSULTEE_COLOUR;
		const isPoints = members.every((feature) => POINT_TYPES.has(feature.geometry?.type));
		const style = isPoints
			? { ...SMALL_CIRCLE_SYMBOL, symbolBackgroundColor: colour }
			: { stroke: colour, strokeWidth: 2, fill: translucent(colour, opacity) };
		return {
			id: `${idPrefix}-${index}`,
			label: `${category} (${members.length})`,
			filter: ['==', ['get', 'consulteeCategory'], category],
			style
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
 * @param {object | undefined} fallback - `config.fallback` from the JSON block
 */
export function showStaticMapFallback(container, fallback) {
	if (container.querySelector('.app-case-map-static')) {
		return;
	}

	if (!fallback?.src) {
		container.textContent =
			'The interactive map could not load. See the consultee list below for the identified organisations.';
		return;
	}

	const src = fallback.src;
	const alt = fallback.alt ?? '';
	const width = fallback.width || 960;
	const height = fallback.height || 516;

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

	// datasets draw in order: the project site on top of the consultee areas
	if (config.consulteeGeojson?.features?.length > 0) {
		datasets.push({
			id: 'consultee-areas',
			label: config.consulteeLayerLabel ?? 'Consultee areas',
			idProperty: 'consulteeId',
			geojson: config.consulteeGeojson,
			minZoom: 0,
			maxZoom: 24,
			showInKey: true,
			showInMenu: true,
			style: {
				stroke: DEFAULT_CONSULTEE_COLOUR,
				strokeWidth: 2,
				fill: translucent(DEFAULT_CONSULTEE_COLOUR, DEFAULT_FILL_OPACITY)
			},
			sublayers: buildCategorySublayers(config.consulteeGeojson.features, 'identified')
		});
	}

	if (config.projectGeojson?.features?.length > 0) {
		datasets.push({
			id: 'project-site',
			label: config.projectLayerLabel ?? 'Project site',
			idProperty: 'reference',
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

	return datasets;
}

const DETAILS_PANEL_ID = 'consultee-details';

/**
 * The map layers a click can select: each consultee sublayer, and the project site. These are
 * MapLibre layer ids as the datasets plugin names them - `<dataset>-<sublayer>` for a sublayer,
 * plus a `-stroke` layer when it's drawn with both a fill and an outline.
 *
 * @param {object[]} datasets - from buildDatasets
 * @returns {object[]}
 */
export function buildSelectableLayers(datasets) {
	const layers = [];
	const add = (layerId, idProperty) => {
		for (const id of [layerId, `${layerId}-stroke`]) {
			layers.push({ layerId: id, idProperty, labelProperty: 'name' });
		}
	};
	for (const dataset of datasets) {
		if (dataset.id === 'project-site') {
			add(dataset.id, dataset.idProperty);
		}
		for (const sublayer of dataset.sublayers ?? []) {
			add(`${dataset.id}-${sublayer.id}`, dataset.idProperty);
		}
	}
	return layers;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

/**
 * The details panel's HTML for a selected feature: a consultee's name, category and region, or the
 * project site's name and reference.
 *
 * @param {object} properties
 * @returns {string}
 */
export function featureDetailsHtml(properties) {
	const rows = properties.consulteeId
		? [
				['Category', properties.consulteeCategory],
				['Region', properties.region]
			]
		: [['Reference', properties.reference]];
	return (
		`<p class="govuk-body govuk-!-font-weight-bold govuk-!-margin-bottom-2">${escapeHtml(properties.name || 'Unnamed')}</p>` +
		rows
			.filter(([, value]) => value)
			.map(([label, value]) => `<p class="govuk-body-s govuk-!-margin-bottom-1">${label}: ${escapeHtml(value)}</p>`)
			.join('')
	);
}

/**
 * Click an area or point to see what it is in a panel; clicking away closes it.
 *
 * @param {object} map - InteractiveMap instance
 * @param {object} interactPlugin
 */
function wireFeatureDetails(map, interactPlugin) {
	map.on('map:ready', () => {
		// the core attaches enable etc. to the plugin when it mounts, so not before map:ready
		interactPlugin.enable();
		map.addPanel(DETAILS_PANEL_ID, {
			focus: false,
			label: 'Selected on the map',
			html: `<div id="${DETAILS_PANEL_ID}-content"></div>`,
			mobile: { slot: 'drawer', dismissible: true },
			tablet: { slot: 'left-top', dismissible: true, width: '300px' },
			desktop: { slot: 'left-top', dismissible: true, width: '300px' }
		});
		map.hidePanel(DETAILS_PANEL_ID);
	});
	map.on('interact:selectionchange', ({ selectedFeatures }) => {
		if (selectedFeatures.length > 0) {
			document.getElementById(`${DETAILS_PANEL_ID}-content`).innerHTML = featureDetailsHtml(
				selectedFeatures[0].properties
			);
			map.showPanel(DETAILS_PANEL_ID);
		} else {
			map.hidePanel(DETAILS_PANEL_ID);
		}
	});
	map.on('app:panelclosed', ({ panelId }) => {
		if (panelId === DETAILS_PANEL_ID) {
			interactPlugin.clear();
		}
	});
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
		showStaticMapFallback(container, config?.fallback);
		return;
	}

	container.replaceChildren();
	container.classList.add('app-case-map-interactive');

	try {
		const datasets = buildDatasets(config);
		const datasetsPlugin = defra.datasetsPlugin({ datasets });
		const mapKeyPlugin = defra.mapKeyPlugin();
		const interactPlugin = defra.interactPlugin?.({
			interactionModes: ['selectFeature'],
			deselectOnClickOutside: true,
			layers: buildSelectableLayers(datasets)
		});

		const map = new defra.InteractiveMap(mapId, {
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
			plugins: [datasetsPlugin, mapKeyPlugin, ...(interactPlugin ? [interactPlugin] : [])]
		});
		if (interactPlugin) {
			wireFeatureDetails(map, interactPlugin);
		}
	} catch {
		showStaticMapFallback(container, config.fallback);
	}
}

export function initAllConsulteeMaps() {
	const containers = document.querySelectorAll('.app-consultee-map');
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
