/**
 * Defra Interactive Map demo: toggleable overlay layers (project, rail, roads, constraints).
 *
 * Uses datasetsPlugin + mapKeyPlugin so UX can try the built-in Layers / Key panels
 * without leaving the Defra component.
 */

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
export function showMapUnavailable(container) {
	container.replaceChildren();
	container.classList.remove('app-case-map-interactive');

	const message = document.createElement('p');
	message.className = 'govuk-body';
	message.textContent =
		'The interactive map could not load. Layer toggles need JavaScript and the Defra Interactive Map scripts.';
	container.append(message);
}

/**
 * Build Defra datasetsPlugin entries. Each dataset with showInMenu appears as a Layers checkbox.
 *
 * @param {object} config
 * @returns {object[]}
 */
export function buildDatasets(config) {
	/** @type {object[]} */
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
				strokeWidth: 2,
				fill: '#C44E52',
				fillOpacity: 0.45
			}
		});
	}

	if (config.railwayGeojson?.features?.length > 0) {
		datasets.push({
			id: 'railways',
			label: config.railwayLayerLabel ?? 'Railway lines',
			geojson: config.railwayGeojson,
			minZoom: 0,
			maxZoom: 24,
			showInKey: true,
			showInMenu: true,
			style: {
				stroke: '#1d70b8',
				strokeWidth: 3,
				strokeDashArray: [2, 2]
			}
		});
	}

	if (config.roadGeojson?.features?.length > 0) {
		datasets.push({
			id: 'roads',
			label: config.roadLayerLabel ?? 'Road network',
			geojson: config.roadGeojson,
			minZoom: 0,
			maxZoom: 24,
			showInKey: true,
			showInMenu: true,
			style: {
				stroke: '#f47738',
				strokeWidth: 3
			}
		});
	}

	if (config.constraintGeojson?.features?.length > 0) {
		datasets.push({
			id: 'constraints',
			label: config.constraintLayerLabel ?? 'Flood risk area',
			geojson: config.constraintGeojson,
			minZoom: 0,
			maxZoom: 24,
			showInKey: true,
			showInMenu: true,
			style: {
				stroke: '#4c2c92',
				strokeWidth: 2,
				fill: '#4c2c92',
				fillOpacity: 0.25
			}
		});
	}

	return datasets;
}

/**
 * @param {string} mapId
 */
export function initMapLayersDemo(mapId) {
	const config = readMapConfig(mapId);
	const container = document.getElementById(mapId);
	if (!container) {
		return;
	}

	const defra = window.defra;
	if (!config || !defra?.InteractiveMap || !defra.maplibreProvider) {
		showMapUnavailable(container);
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
		showMapUnavailable(container);
	}
}

export function initAllMapLayersDemos() {
	const containers = document.querySelectorAll('[data-map-layers-demo]');
	for (const container of containers) {
		if (container instanceof HTMLElement && container.id) {
			initMapLayersDemo(container.id);
		}
	}
}

/**
 * @param {Document | undefined} documentTarget
 */
export function registerMapLayersDemo(documentTarget = globalThis.document) {
	if (!documentTarget) {
		return;
	}

	if (documentTarget.readyState === 'loading') {
		documentTarget.addEventListener('DOMContentLoaded', initAllMapLayersDemos);
		return;
	}

	initAllMapLayersDemos();
}

registerMapLayersDemo();
