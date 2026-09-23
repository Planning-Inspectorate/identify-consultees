/**
 * Initialise Defra Interactive Maps for each consultee section on the results page.
 *
 * Pattern ported from PINS-data-spike `uploads-map.js` / `case-map.js`:
 * - datasetsPlugin + mapKeyPlugin for layers and legend
 * - OpenFreeMap Liberty basemap
 * - Static SVG fallback via data-static-map-src when interactive init fails
 */

const CONSULTEE_COLOURS = ['#55A868', '#4C72B0', '#DD8452', '#8172B2', '#C44E52'];

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
				fill: '#C44E52',
				fillOpacity: 0.45
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
			style: {
				stroke: colour,
				fill: colour,
				fillOpacity: 0.35
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
