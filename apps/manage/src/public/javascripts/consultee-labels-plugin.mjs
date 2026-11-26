/**
 * Consultee-name labels plugin (spike) for the Defra Interactive Map.
 *
 * Today a consultee is only named when it's clicked and the "Selected on the map" panel
 * opens - naming a whole map's worth means clicking each feature. This plugin draws a
 * MapLibre `symbol` text layer per consultee sublayer, so every consultee carries its
 * name once the map is zoomed to the configured level (`minZoom`, page-configurable as
 * `labelMinZoom`; collision detection declutters what won't fit). A "Consultee names"
 * toolbar button toggles the labels; they are on by default.
 *
 *   const consulteeLabelsPlugin = createConsulteeLabelsPlugin({ datasets, minZoom: config.labelMinZoom });
 *   new defra.InteractiveMap(mapId, { ..., plugins: [datasetsPlugin, consulteeLabelsPlugin, ...] });
 *
 * Pass the same `datasets` array given to `defra.datasetsPlugin`: each consultee
 * sublayer's id names the leaf layer it pairs with, and its `filter` is reused so a
 * label layer covers exactly the features its sublayer draws. Labels draw from a
 * dedicated one-point-per-feature GeoJSON source built from the dataset's `geojson`
 * (so a MultiPolygon consultee is named once, on its largest part). Without `geojson`,
 * they fall back to the dataset's own source - found by scanning the style for the leaf
 * layers, so nothing is assumed about how the datasets plugin names sources internally.
 *
 * The text font is the basemap's own: the first font stack a style text layer declares
 * (Liberty's, or the OS Light style's - both serve OpenFreeMap's glyphs; see
 * app/maps/os-maps.ts), so the labels always render in a font the glyphs URL has.
 *
 * Lifecycle: the layers are (re)applied from the InitComponent on `map:ready`, on the
 * map's own `idle` (which covers the datasets plugin's layer init and a basemap style
 * swap wiping the style), and on `datasets:changed` (which covers a Layers-panel toggle
 * hiding a category - its labels follow their sublayer's visibility).
 *
 * The file is `.mjs`, not `.js`: the build fingerprints `javascripts/*.js` (content-hash
 * renames the file), so modules importing this one need a specifier that step leaves alone.
 */

const BUTTON_ID = 'consulteeLabels';
const DATASET_ID = 'consultee-areas';
const LABELS_LAYER_SUFFIX = '-names';
/** Dedicated GeoJSON source of one Point per consultee - avoids MapLibre placing a
 *  symbol on every Polygon part of a MultiPolygon (which duplicates names on the map). */
const LABELS_SOURCE_SUFFIX = '-label-points';
export const DEFAULT_LABEL_MIN_ZOOM = 8;

// both basemaps' glyphs come from tiles.openfreemap.org (see os-maps.ts), whose
// fontstacks include Noto Sans - the fallback when the style itself declares no text
// layer to borrow a font from
const FALLBACK_TEXT_FONT = ['Noto Sans Regular'];

const LABELS_ICON_SVG =
	'<path d="M2 4a2 2 0 0 1 2-2h6l10 10-8 8L2 12z"></path>' + '<circle cx="7" cy="7" r="2"></circle>';

/**
 * The font stack to label with: the first literal `text-font` the loaded style's text
 * layers use, so labels match the basemap's lettering and are guaranteed to exist in
 * its glyphs URL. A style with no text layers (the OS Light style is raster-only)
 * falls back to Noto Sans, which its OpenFreeMap glyphs serve.
 *
 * @param {object[]} styleLayers - `map.getStyle().layers`
 * @returns {string[]}
 */
export function basemapTextFont(styleLayers) {
	for (const layer of styleLayers ?? []) {
		const font = layer?.layout?.['text-font'];
		if (Array.isArray(font) && font.length > 0 && font.every((name) => typeof name === 'string')) {
			return font;
		}
	}
	return [...FALLBACK_TEXT_FONT];
}

/**
 * The dataset's GeoJSON source id, found through its leaf layers rather than assumed:
 * a layer's `source` names it once the datasets plugin has drawn (`<dataset>-<sublayer>`,
 * `-stroke` for an outlined fill). Undefined until the layers exist - the caller retries
 * on the next map event.
 *
 * @param {object[]} styleLayers - `map.getStyle().layers`
 * @param {object} dataset - the datasets-array entry
 * @returns {string | undefined}
 */
export function datasetSourceId(styleLayers, dataset) {
	const layerIds = new Set([
		dataset.id,
		...(dataset.sublayers ?? []).map((sublayer) => `${dataset.id}-${sublayer.id}`)
	]);
	for (const layer of styleLayers ?? []) {
		const id = String(layer?.id ?? '');
		if (layerIds.has(id) || layerIds.has(id.replace(/-stroke$/, ''))) {
			return layer.source;
		}
	}
	return undefined;
}

/**
 * Approximate signed area of a ring (shoelace). Used only to pick the largest part of a
 * MultiPolygon for its single label point - absolute value, not a real-world area.
 *
 * @param {[number, number][]} ring
 * @returns {number}
 */
function ringArea(ring) {
	let sum = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
	}
	return sum / 2;
}

/**
 * Average of a ring's vertices, skipping a duplicated closing coordinate when present.
 *
 * @param {[number, number][] | undefined} ring
 * @returns {[number, number] | undefined}
 */
function ringCentroid(ring) {
	if (!ring?.length) {
		return undefined;
	}
	const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
	const count = closed ? ring.length - 1 : ring.length;
	let lng = 0;
	let lat = 0;
	for (let i = 0; i < count; i++) {
		lng += ring[i][0];
		lat += ring[i][1];
	}
	return [lng / count, lat / count];
}

/**
 * One map coordinate to label a feature at. MapLibre's `symbol-placement: point` otherwise
 * places a label on every Polygon inside a MultiPolygon, so an unparished area (or any
 * multi-part boundary) would show the same name several times. Prefer the largest part.
 *
 * @param {object | undefined} geometry - a GeoJSON geometry
 * @returns {[number, number] | undefined}
 */
export function labelPointOfGeometry(geometry) {
	if (!geometry?.type) {
		return undefined;
	}
	switch (geometry.type) {
		case 'Point':
			return geometry.coordinates;
		case 'MultiPoint':
			return geometry.coordinates?.[0];
		case 'LineString': {
			const coords = geometry.coordinates ?? [];
			return coords[Math.floor(coords.length / 2)];
		}
		case 'MultiLineString': {
			let best;
			let bestLength = 0;
			for (const line of geometry.coordinates ?? []) {
				const length = line?.length ?? 0;
				if (length > bestLength) {
					bestLength = length;
					best = line[Math.floor(length / 2)];
				}
			}
			return best;
		}
		case 'Polygon':
			return ringCentroid(geometry.coordinates?.[0]);
		case 'MultiPolygon': {
			let best;
			let bestArea = -1;
			for (const polygon of geometry.coordinates ?? []) {
				const area = Math.abs(ringArea(polygon?.[0] ?? []));
				if (area > bestArea) {
					bestArea = area;
					best = ringCentroid(polygon?.[0]);
				}
			}
			return best;
		}
		default:
			return undefined;
	}
}

/**
 * A Point FeatureCollection for label layers: one point per consultee feature (deduped by
 * `consulteeId` / feature id), carrying the same properties the sublayer filters match on.
 *
 * @param {object[]} features - GeoJSON features from the consultee dataset
 * @returns {{ type: 'FeatureCollection', features: object[] }}
 */
export function labelPointCollection(features) {
	const seen = new Set();
	const points = [];
	for (const feature of features ?? []) {
		const id = feature?.properties?.consulteeId ?? feature?.id;
		if (id != null) {
			const key = String(id);
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
		}
		const coordinates = labelPointOfGeometry(feature?.geometry);
		if (!coordinates) {
			continue;
		}
		points.push({
			type: 'Feature',
			...(feature.id !== undefined ? { id: feature.id } : {}),
			properties: feature.properties ?? {},
			geometry: { type: 'Point', coordinates }
		});
	}
	return { type: 'FeatureCollection', features: points };
}

/**
 * One sublayer's label layer: `symbol` text at the feature's `name`, anchored under a
 * point consultee's dot or centred on an area. `minzoom` is the configured level names
 * appear from; collision detection (the defaults - no `text-allow-overlap`) declutters
 * what won't fit at wider zooms.
 *
 * @param {object} dataset - the consultee dataset entry
 * @param {object} sublayer - one of its sublayers (id, filter, style)
 * @param {object} options
 * @param {string} options.sourceId - the labels' GeoJSON source (point-per-feature when
 *   available, otherwise the dataset's own source)
 * @param {number} options.minZoom - labels appear from this zoom
 * @param {string[]} options.textFont - the font stack, from basemapTextFont
 * @returns {object} a MapLibre layer definition
 */
export function consulteeLabelLayer(dataset, sublayer, { sourceId, minZoom, textFont }) {
	// a point sublayer draws dots (a symbol style), so its labels anchor below the dot;
	// an area's sit in the middle of it
	const isPoint = Boolean(sublayer.style?.symbol || sublayer.style?.symbolSvgContent);
	return {
		id: `${dataset.id}-${sublayer.id}${LABELS_LAYER_SUFFIX}`,
		type: 'symbol',
		source: sourceId,
		minzoom: minZoom,
		...(sublayer.filter ? { filter: sublayer.filter } : {}),
		layout: {
			'text-field': ['get', 'name'],
			'text-font': textFont,
			'text-size': 12,
			'symbol-placement': 'point',
			'text-max-width': 8,
			'text-line-height': 1.1,
			...(isPoint ? { 'text-anchor': 'top', 'text-offset': [0, 0.8] } : { 'text-anchor': 'center' })
		},
		paint: {
			'text-color': '#0b0c0c',
			'text-halo-color': '#ffffff',
			'text-halo-width': 1.4,
			'text-halo-blur': 0.5
		}
	};
}

/**
 * Where the labels' on/off state lives. im-core hands each plugin context its own
 * merged copy of pluginConfig, so a mutation made in one context (the button's
 * `onClick`) never reaches another (the InitComponent's `idle` resync would flip the
 * labels straight back on). The MapLibre map object *is* shared, so the flag is
 * stashed on it; `pluginConfig.labelsOn` remains the default before any toggle.
 */
const LABELS_ON_PROPERTY = 'consulteeLabelsOn';

/**
 * @param {object | undefined} map - the MapLibre map
 * @param {object | undefined} pluginConfig
 * @returns {boolean} whether labels should draw right now
 */
export function labelsEnabled(map, pluginConfig) {
	return (map?.[LABELS_ON_PROPERTY] ?? pluginConfig?.labelsOn) !== false;
}

/**
 * Whether the sublayer a label pairs with is drawn - read off the sibling layer itself
 * so a Layers-panel toggle carries across; a sibling not yet drawn falls back to the
 * sublayer's own `visible` flag.
 *
 * @param {object} map - the MapLibre map
 * @param {object} dataset
 * @param {object} sublayer
 * @returns {boolean}
 */
export function siblingVisible(map, dataset, sublayer) {
	const sibling = map.getLayer?.(`${dataset.id}-${sublayer.id}`);
	return sibling ? sibling.layout?.visibility !== 'none' : sublayer.visible !== false;
}

/**
 * The GeoJSON source labels should draw from: a dedicated one-point-per-feature source
 * when the dataset carries `geojson` (so MultiPolygon consultees get a single name),
 * otherwise the dataset's own source once its leaf layers exist.
 *
 * @param {object} map - the MapLibre map
 * @param {object} dataset
 * @param {object[]} styleLayers
 * @returns {string | undefined}
 */
function ensureLabelSourceId(map, dataset, styleLayers) {
	const features = dataset.geojson?.features;
	if (features?.length) {
		const labelSourceId = `${dataset.id}${LABELS_SOURCE_SUFFIX}`;
		if (!map.getSource?.(labelSourceId)) {
			map.addSource?.(labelSourceId, {
				type: 'geojson',
				data: labelPointCollection(features)
			});
		}
		return map.getSource?.(labelSourceId) ? labelSourceId : undefined;
	}
	return datasetSourceId(styleLayers, dataset);
}

/**
 * Add any missing label layers and bring every one's visibility in line - idempotent,
 * so it can run on every map event: a label shows where labels are on
 * (`labelsEnabled`) and its sublayer is drawn. Prefers a point-per-feature source built
 * from the dataset's `geojson` so MultiPolygon consultees are named once; falls back to
 * the dataset source once its leaf layers exist. Callers can fire it early and let
 * `idle`/`datasets:changed` land it.
 *
 * @param {object | undefined} map - the MapLibre map
 * @param {object} pluginConfig - the plugin descriptor (datasets, datasetId, minZoom, labelsOn, mlMap)
 */
export function syncConsulteeLabels(map, pluginConfig) {
	const dataset = (pluginConfig?.datasets ?? []).find((entry) => entry.id === (pluginConfig?.datasetId ?? DATASET_ID));
	const sublayers = dataset?.sublayers ?? [];
	if (!map?.getStyle || sublayers.length === 0) {
		return;
	}
	const styleLayers = map.getStyle()?.layers ?? [];
	const sourceId = ensureLabelSourceId(map, dataset, styleLayers);
	if (!sourceId) {
		return;
	}
	const textFont = basemapTextFont(styleLayers);
	for (const sublayer of sublayers) {
		const id = `${dataset.id}-${sublayer.id}${LABELS_LAYER_SUFFIX}`;
		if (!map.getLayer?.(id)) {
			map.addLayer?.(
				consulteeLabelLayer(dataset, sublayer, {
					sourceId,
					minZoom: pluginConfig.minZoom ?? DEFAULT_LABEL_MIN_ZOOM,
					textFont
				})
			);
		}
		const visible = labelsEnabled(map, pluginConfig) && siblingVisible(map, dataset, sublayer);
		map.setLayoutProperty?.(id, 'visibility', visible ? 'visible' : 'none');
	}
}

/**
 * The "Consultee names" button's toggle: flips the shared labels flag on the map
 * instance (the button's pressed state follows via pluginState's own store),
 * reapplies visibility, and announces the change to screen readers.
 *
 * @param {object} context - PluginContext ({ pluginConfig, pluginState, services, mapProvider })
 */
export function toggleConsulteeLabels(context) {
	const { pluginConfig, pluginState, services, mapProvider } = context ?? {};
	const map = mapProvider?.map ?? pluginConfig?.mlMap;
	const labelsOn = !labelsEnabled(map, pluginConfig);
	if (map) {
		map[LABELS_ON_PROPERTY] = labelsOn;
	}
	pluginState?.dispatch?.({ type: 'SET_LABELS_ON', payload: labelsOn });
	syncConsulteeLabels(map, pluginConfig);
	services?.announce?.(labelsOn ? 'Consultee names shown' : 'Consultee names hidden');
}

/**
 * Plugin init: stores the MapLibre map when `map:ready` reports it (or takes the
 * provider's if it already has one - an InitComponent can mount after that), resyncs
 * the labels on `datasets:ready`/`datasets:changed`, and re-applies them on every
 * `idle` - covering both the datasets plugin finishing its own layer init and a
 * basemap style swap wiping every layer.
 */
export function ConsulteeLabelsInit({ pluginConfig, services, mapProvider }) {
	const { useEffect } = globalThis.preactCompat ?? {};

	useEffect?.(() => {
		const ensure = () => syncConsulteeLabels(pluginConfig?.mlMap ?? mapProvider?.map, pluginConfig);
		const attach = (map) => {
			if (!map || !pluginConfig || pluginConfig.mlMap === map) {
				return;
			}
			pluginConfig.mlMap = map;
			map.on?.('idle', ensure);
			ensure();
		};
		const onReady = ({ map } = {}) => attach(map);
		const { eventBus } = services ?? {};
		eventBus?.on?.('map:ready', onReady);
		eventBus?.on?.('datasets:ready', ensure);
		eventBus?.on?.('datasets:changed', ensure);
		attach(mapProvider?.map);
		return () => {
			eventBus?.off?.('map:ready', onReady);
			eventBus?.off?.('datasets:ready', ensure);
			eventBus?.off?.('datasets:changed', ensure);
			pluginConfig.mlMap?.off?.('idle', ensure);
			pluginConfig.mlMap = undefined;
		};
	}, [services, mapProvider]);

	return null;
}

/**
 * @param {boolean} labelsOn - the descriptor's initial state, so the button's pressed
 *   state and the layers start in step
 * @returns {object} the plugin manifest
 */
function buildManifest(labelsOn) {
	return {
		reducer: {
			initialState: { labelsOn },
			actions: {
				SET_LABELS_ON: (state, on) => ({ ...state, labelsOn: on })
			}
		},
		InitComponent: ConsulteeLabelsInit,
		icons: [{ id: 'app-consultee-labels', svgContent: LABELS_ICON_SVG }],
		buttons: [
			{
				id: BUTTON_ID,
				label: ({ pluginConfig }) => pluginConfig?.buttonLabel ?? 'Consultee names',
				iconId: 'app-consultee-labels',
				keepFocus: true,
				mobile: { slot: 'top-left', showLabel: true },
				tablet: { slot: 'top-left', showLabel: true },
				desktop: { slot: 'top-left', showLabel: true },
				onClick: (event, context) => toggleConsulteeLabels(context),
				pressedWhen: (context) => context.pluginState?.labelsOn !== false
			}
		]
	};
}

/**
 * @param {object} [options]
 * @param {object[]} [options.datasets] - the same array passed to `defra.datasetsPlugin`:
 *   its `consultee-areas` entry's sublayers get a label layer each
 * @param {string} [options.datasetId] - the dataset to label (default 'consultee-areas')
 * @param {number} [options.minZoom] - labels appear from this zoom (default 8) - a page
 *   config's `labelMinZoom` tunes it per map
 * @param {boolean} [options.labelsOn] - labels on by default (true); false starts hidden
 * @param {string} [options.buttonLabel] - toolbar button text (default 'Consultee names')
 * @returns {object} PluginDescriptor for InteractiveMap's `plugins` option
 */
export function createConsulteeLabelsPlugin(options = {}) {
	const labelsOn = options.labelsOn !== false;
	return {
		id: 'consulteeLabels',
		datasets: options.datasets ?? [],
		datasetId: options.datasetId ?? DATASET_ID,
		minZoom: typeof options.minZoom === 'number' ? options.minZoom : DEFAULT_LABEL_MIN_ZOOM,
		labelsOn,
		buttonLabel: options.buttonLabel,
		// the MapLibre map, once map:ready or the provider hands it over (ConsulteeLabelsInit)
		mlMap: undefined,
		load: async () => buildManifest(labelsOn)
	};
}
