import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import {
	ConsulteeLabelsInit,
	DEFAULT_LABEL_MIN_ZOOM,
	basemapTextFont,
	consulteeLabelLayer,
	createConsulteeLabelsPlugin,
	datasetSourceId,
	labelPointCollection,
	labelPointOfGeometry,
	labelsEnabled,
	siblingVisible,
	syncConsulteeLabels,
	toggleConsulteeLabels
} from './consultee-labels-plugin.mjs';

let compat;
let dom;

async function installDom() {
	dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
	globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
	// the map's UMD bundle exposes preact/compat on window for plugin authors
	compat = compat ?? (await import('preact/compat'));
	globalThis.preactCompat = compat;
	return dom;
}

afterEach(() => {
	delete globalThis.window;
	delete globalThis.document;
	delete globalThis.HTMLElement;
	delete globalThis.preactCompat;
	delete globalThis.requestAnimationFrame;
	delete globalThis.cancelAnimationFrame;
});

const flushEffects = () => new Promise((resolve) => setTimeout(resolve, 10));

// effect wiring lands through preact's afterPaint flush - a rAF + setTimeout
// chain that can outlast a single flushEffects sleep on a loaded CI agent
const waitFor = async (predicate, attempts = 50) => {
	for (let attempt = 0; attempt < attempts && !predicate(); attempt++) {
		await flushEffects();
	}
};

/**
 * A minimal MapLibre stand-in: keeps layers in a Map so getLayer/getStyle reflect
 * addLayer and setLayoutProperty like the real thing does.
 *
 * @param {object[]} styleLayers - layers the style starts with
 */
function fakeMaplibre(styleLayers = []) {
	// copied, so a setLayoutProperty in one test can't leak into the shared fixtures
	const layers = new Map(styleLayers.map((layer) => [layer.id, { ...layer, layout: { ...layer.layout } }]));
	const sources = new Map();
	return {
		layers,
		sources,
		getStyle: () => ({ layers: [...layers.values()] }),
		getLayer: (id) => layers.get(id),
		getSource: (id) => sources.get(id),
		addSource: mock.fn((id, source) => {
			sources.set(id, {
				...source,
				setData: mock.fn((data) => {
					sources.get(id).data = data;
				})
			});
		}),
		addLayer: mock.fn((layer) =>
			layers.set(layer.id, { ...layer, layout: { visibility: 'visible', ...layer.layout } })
		),
		setLayoutProperty: mock.fn((id, property, value) => {
			const layer = layers.get(id);
			if (layer) {
				layer.layout = { ...(layer.layout ?? {}), [property]: value };
			}
		}),
		on: mock.fn(),
		off: mock.fn()
	};
}

function fakeEventBus() {
	const listeners = new Map();
	return {
		on: mock.fn((event, handler) => {
			listeners.set(event, [...(listeners.get(event) ?? []), handler]);
		}),
		off: mock.fn((event, handler) => {
			listeners.set(
				event,
				(listeners.get(event) ?? []).filter((existing) => existing !== handler)
			);
		}),
		emit(event, payload) {
			for (const handler of listeners.get(event) ?? []) {
				handler(payload);
			}
		},
		listenerCount: (event) => (listeners.get(event) ?? []).length
	};
}

const AREA_SUBLAYER = {
	id: 'identified-0',
	label: 'Councils',
	visible: true,
	style: { fill: { color: '#000000' } },
	filter: ['==', ['get', 'consulteeCategory'], 'Councils']
};

const POINT_SUBLAYER = {
	id: 'identified-1',
	label: 'Hospitals',
	visible: true,
	style: { symbol: { symbolSvgContent: '<svg />' } },
	filter: ['==', ['get', 'consulteeCategory'], 'Hospitals']
};

const SQUARE = [
	[0, 0],
	[0, 2],
	[2, 2],
	[2, 0],
	[0, 0]
];
const SMALL_SQUARE = [
	[10, 10],
	[10, 10.5],
	[10.5, 10.5],
	[10.5, 10],
	[10, 10]
];

const DATASET = {
	id: 'consultee-areas',
	sublayers: [AREA_SUBLAYER, POINT_SUBLAYER],
	geojson: {
		type: 'FeatureCollection',
		features: [
			{
				id: 'sunderland',
				properties: {
					consulteeId: 'sunderland',
					name: 'Sunderland, unparished area (Sunderland, 3.6 km from the site)',
					consulteeCategory: 'Councils'
				},
				geometry: {
					type: 'MultiPolygon',
					coordinates: [[SMALL_SQUARE], [SQUARE], [SMALL_SQUARE]]
				}
			},
			{
				id: 'hospital',
				properties: {
					consulteeId: 'hospital',
					name: 'City Hospital',
					consulteeCategory: 'Hospitals'
				},
				geometry: { type: 'Point', coordinates: [-1.4, 54.9] }
			}
		]
	}
};

describe('labelPointOfGeometry', () => {
	test('returns points and the middle of a line as-is', () => {
		assert.deepEqual(labelPointOfGeometry({ type: 'Point', coordinates: [-1, 54] }), [-1, 54]);
		assert.deepEqual(
			labelPointOfGeometry({
				type: 'MultiPoint',
				coordinates: [
					[1, 2],
					[3, 4]
				]
			}),
			[1, 2]
		);
		assert.deepEqual(
			labelPointOfGeometry({
				type: 'LineString',
				coordinates: [
					[0, 0],
					[1, 1],
					[2, 2]
				]
			}),
			[1, 1]
		);
	});

	test('centres a polygon on its outer ring', () => {
		assert.deepEqual(labelPointOfGeometry({ type: 'Polygon', coordinates: [SQUARE] }), [1, 1]);
	});

	test('picks the largest part of a MultiPolygon so one feature yields one label point', () => {
		assert.deepEqual(
			labelPointOfGeometry({
				type: 'MultiPolygon',
				coordinates: [[SMALL_SQUARE], [SQUARE], [SMALL_SQUARE]]
			}),
			[1, 1]
		);
	});

	test('returns undefined for empty or unknown geometry', () => {
		assert.equal(labelPointOfGeometry(undefined), undefined);
		assert.equal(labelPointOfGeometry({ type: 'Polygon', coordinates: [[]] }), undefined);
		assert.equal(labelPointOfGeometry({ type: 'GeometryCollection', geometries: [] }), undefined);
	});
});

describe('labelPointCollection', () => {
	test('emits one Point feature per input, keeping properties and dropping empties', () => {
		const collection = labelPointCollection(DATASET.geojson.features);
		assert.equal(collection.type, 'FeatureCollection');
		assert.equal(collection.features.length, 2);
		assert.deepEqual(collection.features[0].geometry, { type: 'Point', coordinates: [1, 1] });
		assert.equal(collection.features[0].properties.name, DATASET.geojson.features[0].properties.name);
		assert.deepEqual(collection.features[1].geometry, { type: 'Point', coordinates: [-1.4, 54.9] });
	});

	test('keeps only the first feature when the same consulteeId appears twice', () => {
		const duplicate = {
			...DATASET.geojson.features[0],
			geometry: { type: 'Point', coordinates: [9, 9] }
		};
		const collection = labelPointCollection([DATASET.geojson.features[0], duplicate]);
		assert.equal(collection.features.length, 1);
		assert.deepEqual(collection.features[0].geometry.coordinates, [1, 1]);
	});
});

// the leaf layers the datasets plugin draws for DATASET (fill + icon symbol) and the
// source they share
const LEAF_LAYERS = [
	{ id: 'consultee-areas-identified-0', source: 'geojson-consultee-areas', layout: {} },
	{ id: 'consultee-areas-identified-0-stroke', source: 'geojson-consultee-areas', layout: {} },
	{ id: 'consultee-areas-identified-1', source: 'geojson-consultee-areas', layout: {} }
];

const LABEL_0 = 'consultee-areas-identified-0-names';
const LABEL_1 = 'consultee-areas-identified-1-names';

describe('basemapTextFont', () => {
	test('falls back to Noto Sans with no or no usable style layers', () => {
		for (const styleLayers of [undefined, null, [], [null], [{ layout: {} }]]) {
			assert.deepEqual(basemapTextFont(styleLayers), ['Noto Sans Regular']);
		}
	});

	test('reuses the first literal font stack a style text layer declares', () => {
		const layers = [
			{ layout: { 'text-font': ['literal', ['Font A', 'Font B']] } }, // an expression, not a stack
			{ layout: { 'text-font': 'Noto Sans Regular' } }, // a string, not an array
			{ layout: { 'text-font': [] } }, // empty
			{ layout: { 'text-font': ['Open Sans Regular', 'Open Sans Bold'] } },
			{ layout: { 'text-font': ['Roboto Regular'] } }
		];
		assert.deepEqual(basemapTextFont(layers), ['Open Sans Regular', 'Open Sans Bold']);
	});
});

describe('datasetSourceId', () => {
	test('finds the source through the dataset, a sublayer and a -stroke leaf layer', () => {
		const sources = [
			[{ id: 'consultee-areas', source: 'src-a' }],
			[{ id: 'consultee-areas-identified-0', source: 'src-b' }],
			[{ id: 'consultee-areas-identified-0-stroke', source: 'src-c' }]
		];
		for (const [index, styleLayers] of sources.entries()) {
			assert.equal(datasetSourceId(styleLayers, DATASET), `src-${'abc'[index]}`);
		}
	});

	test('returns undefined when no leaf layer belongs to the dataset', () => {
		assert.equal(datasetSourceId([{ id: 'other-dataset-0', source: 'src' }], DATASET), undefined);
		assert.equal(datasetSourceId([], DATASET), undefined);
		assert.equal(datasetSourceId(undefined, DATASET), undefined);
		assert.equal(datasetSourceId([{ source: 'src' }], DATASET), undefined); // a layer with no id
		assert.equal(datasetSourceId([null], DATASET), undefined); // or a null layer
	});

	test('matches the dataset layer itself even when it has no sublayers', () => {
		assert.equal(datasetSourceId([{ id: 'consultee-areas', source: 'src' }], { id: 'consultee-areas' }), 'src');
	});
});

describe('consulteeLabelLayer', () => {
	const options = { sourceId: 'geojson-consultee-areas', minZoom: 9, textFont: ['Noto Sans Regular'] };

	test('labels an area sublayer with centred text and the sublayer filter', () => {
		const layer = consulteeLabelLayer(DATASET, AREA_SUBLAYER, options);
		assert.equal(layer.id, LABEL_0);
		assert.equal(layer.type, 'symbol');
		assert.equal(layer.source, 'geojson-consultee-areas');
		assert.equal(layer.minzoom, 9);
		assert.deepEqual(layer.filter, AREA_SUBLAYER.filter);
		assert.deepEqual(layer.layout['text-field'], ['get', 'name']);
		assert.equal(layer.layout['text-anchor'], 'center');
		assert.equal(layer.layout['text-offset'], undefined);
	});

	test("anchors a point sublayer's label under its dot", () => {
		const layer = consulteeLabelLayer(DATASET, POINT_SUBLAYER, options);
		assert.equal(layer.layout['text-anchor'], 'top');
		assert.deepEqual(layer.layout['text-offset'], [0, 0.8]);
	});

	test('treats an svg-symbol sublayer as a point and tolerates a sublayer without a filter', () => {
		const svgPoint = { id: 'p', style: { symbolSvgContent: '<svg />' } };
		const layer = consulteeLabelLayer(DATASET, svgPoint, options);
		assert.equal(layer.layout['text-anchor'], 'top');
		assert.equal(layer.filter, undefined);
	});

	test('treats a sublayer with no style as an area', () => {
		assert.equal(consulteeLabelLayer(DATASET, { id: 'a' }, options).layout['text-anchor'], 'center');
	});
});

describe('labelsEnabled', () => {
	const map = {};

	test('defaults to the plugin config until the map carries a flag', () => {
		assert.equal(labelsEnabled(undefined, undefined), true);
		assert.equal(labelsEnabled(map, { labelsOn: true }), true);
		assert.equal(labelsEnabled(map, { labelsOn: false }), false);
	});

	test('the flag stashed on the map wins over the config default', () => {
		const on = { consulteeLabelsOn: true };
		const off = { consulteeLabelsOn: false };
		assert.equal(labelsEnabled(on, { labelsOn: false }), true);
		assert.equal(labelsEnabled(off, { labelsOn: true }), false);
	});
});

describe('siblingVisible', () => {
	test("reads the sibling layer's own visibility when it is drawn", () => {
		const visible = fakeMaplibre([{ id: 'consultee-areas-identified-0', layout: {} }]);
		assert.equal(siblingVisible(visible, DATASET, AREA_SUBLAYER), true);
		const hidden = fakeMaplibre([{ id: 'consultee-areas-identified-0', layout: { visibility: 'none' } }]);
		assert.equal(siblingVisible(hidden, DATASET, AREA_SUBLAYER), false);
	});

	test("falls back to the sublayer's visible flag until its layer exists", () => {
		const map = fakeMaplibre([]);
		assert.equal(siblingVisible(map, DATASET, AREA_SUBLAYER), true);
		assert.equal(siblingVisible(map, DATASET, { ...AREA_SUBLAYER, visible: false }), false);
	});

	test('a sibling layer without a layout counts as visible', () => {
		const map = fakeMaplibre([{ id: 'consultee-areas-identified-0', source: 'src' }]);
		assert.equal(siblingVisible(map, DATASET, AREA_SUBLAYER), true);
	});
});

describe('syncConsulteeLabels', () => {
	const pluginConfig = (overrides = {}) => ({
		datasets: [DATASET],
		datasetId: 'consultee-areas',
		minZoom: 9,
		labelsOn: true,
		...overrides
	});

	test('no-ops without a map or a consultee dataset to label', () => {
		syncConsulteeLabels(undefined, pluginConfig());
		syncConsulteeLabels({} /* no getStyle */, pluginConfig());
		syncConsulteeLabels(fakeMaplibre(LEAF_LAYERS), pluginConfig({ datasets: [] }));
		syncConsulteeLabels(fakeMaplibre(LEAF_LAYERS), pluginConfig({ datasets: [{ id: 'other' }] }));
		syncConsulteeLabels(fakeMaplibre(LEAF_LAYERS), pluginConfig({ datasets: [{ id: 'consultee-areas' }] }));
		syncConsulteeLabels(fakeMaplibre(LEAF_LAYERS), undefined);
	});

	test("no-ops until the dataset's layers give the source away when there is no geojson", () => {
		const map = fakeMaplibre([{ id: 'project-site', source: 'geojson-project' }]);
		const { geojson: _geojson, ...datasetWithoutGeojson } = DATASET;
		syncConsulteeLabels(map, pluginConfig({ datasets: [datasetWithoutGeojson] }));
		assert.equal(map.addLayer.mock.calls.length, 0);
	});

	test('adds a one-point-per-feature source and one label layer per sublayer', () => {
		const map = fakeMaplibre([{ layout: {}, ...LEAF_LAYERS[0] }, ...LEAF_LAYERS.slice(1)]);
		syncConsulteeLabels(map, pluginConfig());
		assert.equal(map.addSource.mock.calls.length, 1);
		assert.equal(map.addSource.mock.calls[0].arguments[0], 'consultee-areas-label-points');
		assert.equal(map.addSource.mock.calls[0].arguments[1].type, 'geojson');
		// MultiPolygon consultees contribute a single point, so names cannot repeat per part
		assert.equal(map.addSource.mock.calls[0].arguments[1].data.features.length, 2);
		assert.equal(map.addLayer.mock.calls.length, 2);
		for (const [layerId, sublayer] of [
			[LABEL_0, AREA_SUBLAYER],
			[LABEL_1, POINT_SUBLAYER]
		]) {
			const layer = map.layers.get(layerId);
			assert.equal(layer.type, 'symbol');
			assert.equal(layer.source, 'consultee-areas-label-points');
			assert.equal(layer.minzoom, 9);
			assert.deepEqual(layer.filter, sublayer.filter);
			assert.equal(layer.layout.visibility, 'visible');
		}
	});

	test('falls back to the default zoom when none is configured', () => {
		const map = fakeMaplibre(LEAF_LAYERS);
		syncConsulteeLabels(map, pluginConfig({ minZoom: undefined }));
		assert.equal(map.layers.get(LABEL_0).minzoom, DEFAULT_LABEL_MIN_ZOOM);
	});

	test('leaves an existing label source and layer alone and only resyncs visibility', () => {
		const map = fakeMaplibre(LEAF_LAYERS);
		syncConsulteeLabels(map, pluginConfig());
		syncConsulteeLabels(map, pluginConfig());
		assert.equal(map.addSource.mock.calls.length, 1);
		assert.equal(map.addLayer.mock.calls.length, 2);
	});

	test('falls back to the dataset polygon source when the dataset has no geojson', () => {
		const map = fakeMaplibre(LEAF_LAYERS);
		const { geojson: _geojson, ...datasetWithoutGeojson } = DATASET;
		syncConsulteeLabels(map, pluginConfig({ datasets: [datasetWithoutGeojson] }));
		assert.equal(map.addSource.mock.calls.length, 0);
		assert.equal(map.layers.get(LABEL_0).source, 'geojson-consultee-areas');
	});

	test('hides the labels of a sublayer its sibling layer hides', () => {
		const map = fakeMaplibre(LEAF_LAYERS);
		syncConsulteeLabels(map, pluginConfig());
		map.setLayoutProperty('consultee-areas-identified-0', 'visibility', 'none');
		syncConsulteeLabels(map, pluginConfig());
		assert.equal(map.layers.get(LABEL_0).layout.visibility, 'none');
		assert.equal(map.layers.get(LABEL_1).layout.visibility, 'visible');
	});

	test('hides every label when labelsOn is off and shows them again on', () => {
		const map = fakeMaplibre(LEAF_LAYERS);
		syncConsulteeLabels(map, pluginConfig({ labelsOn: false }));
		assert.equal(map.layers.get(LABEL_0).layout.visibility, 'none');
		syncConsulteeLabels(map, pluginConfig());
		assert.equal(map.layers.get(LABEL_0).layout.visibility, 'visible');
	});

	test('the flag stashed on the map overrides the config default', () => {
		const map = fakeMaplibre(LEAF_LAYERS);
		map.consulteeLabelsOn = false;
		syncConsulteeLabels(map, pluginConfig());
		assert.equal(map.layers.get(LABEL_0).layout.visibility, 'none');
		map.consulteeLabelsOn = true;
		syncConsulteeLabels(map, pluginConfig({ labelsOn: false }));
		assert.equal(map.layers.get(LABEL_0).layout.visibility, 'visible');
	});

	test('labels the dataset a custom datasetId names', () => {
		const dataset = { id: 'nearby-nsips', sublayers: [{ id: 'own-0', visible: true, style: {} }] };
		const map = fakeMaplibre([{ id: 'nearby-nsips-own-0', source: 'geojson-nearby-nsips', layout: {} }]);
		syncConsulteeLabels(map, pluginConfig({ datasets: [DATASET, dataset], datasetId: 'nearby-nsips' }));
		assert.equal(map.layers.get('nearby-nsips-own-0-names').source, 'geojson-nearby-nsips');
	});

	test('tolerates a map without the layer mutation methods', () => {
		const map = {
			getStyle: () => ({ layers: [{ id: 'consultee-areas-identified-0', source: 'src' }] })
		};
		syncConsulteeLabels(map, pluginConfig());
	});

	test('tolerates an empty style and a config without datasets', () => {
		const map = { getStyle: () => undefined, getLayer: () => undefined };
		syncConsulteeLabels(map, pluginConfig());
		syncConsulteeLabels(fakeMaplibre(LEAF_LAYERS), { datasets: undefined });
	});
});

describe('toggleConsulteeLabels', () => {
	test('tolerates a context without a pluginConfig', () => {
		toggleConsulteeLabels(undefined);
		toggleConsulteeLabels({});
	});

	test('stashes the flag on the map, dispatches, resyncs and announces the change', () => {
		const map = fakeMaplibre(LEAF_LAYERS);
		// im-core hands each context its own merged pluginConfig copy, so the flag
		// lives on the shared map instance - a fresh config object per click, like
		// the real button contexts
		const dispatch = mock.fn();
		const announce = mock.fn();
		const context = () => ({
			pluginConfig: { datasets: [DATASET], minZoom: 9, labelsOn: true },
			pluginState: { dispatch },
			services: { announce },
			mapProvider: { map }
		});
		syncConsulteeLabels(map, { datasets: [DATASET], minZoom: 9, labelsOn: true });

		toggleConsulteeLabels(context());
		assert.equal(map.consulteeLabelsOn, false);
		assert.deepEqual(dispatch.mock.calls[0].arguments[0], { type: 'SET_LABELS_ON', payload: false });
		assert.equal(map.layers.get(LABEL_0).layout.visibility, 'none');
		assert.deepEqual(announce.mock.calls[0].arguments, ['Consultee names hidden']);

		toggleConsulteeLabels(context());
		assert.equal(map.consulteeLabelsOn, true);
		assert.equal(map.layers.get(LABEL_0).layout.visibility, 'visible');
		assert.deepEqual(announce.mock.calls[1].arguments, ['Consultee names shown']);
	});

	test("falls back to the descriptor's map when the context has no provider", () => {
		const map = fakeMaplibre(LEAF_LAYERS);
		const pluginConfig = { datasets: [DATASET], minZoom: 9, labelsOn: true, mlMap: map };
		syncConsulteeLabels(map, pluginConfig);
		toggleConsulteeLabels({ pluginConfig });
		assert.equal(map.consulteeLabelsOn, false);
		assert.equal(map.layers.get(LABEL_0).layout.visibility, 'none');
	});

	test('tolerates a context without state, services or a map', () => {
		const pluginConfig = { datasets: [DATASET], labelsOn: true };
		toggleConsulteeLabels({ pluginConfig });
		toggleConsulteeLabels({ pluginConfig, pluginState: {}, services: {}, mapProvider: {} });
	});
});

describe('ConsulteeLabelsInit', () => {
	const renderInit = async (props) => {
		await installDom();
		const container = document.createElement('div');
		document.body.appendChild(container);
		compat.render(compat.createElement(ConsulteeLabelsInit, props), container);
		await flushEffects();
		return container;
	};

	test('attaches to the provider map, subscribes to events and cleans up', async () => {
		const map = fakeMaplibre(LEAF_LAYERS);
		const eventBus = fakeEventBus();
		const pluginConfig = { datasets: [DATASET], minZoom: 9, labelsOn: true };
		const container = await renderInit({ pluginConfig, services: { eventBus }, mapProvider: { map } });
		await waitFor(() => pluginConfig.mlMap === map);

		assert.equal(map.on.mock.calls[0].arguments[0], 'idle');
		assert.ok(map.layers.get(LABEL_0));
		for (const event of ['map:ready', 'datasets:ready', 'datasets:changed']) {
			assert.equal(eventBus.listenerCount(event), 1, event);
		}

		compat.render(null, container);
		await flushEffects();
		assert.equal(eventBus.listenerCount('map:ready'), 0);
		assert.equal(pluginConfig.mlMap, undefined);
		assert.equal(map.off.mock.calls[0].arguments[0], 'idle');
	});

	test('attaches when map:ready reports the map and keeps the labels in step', async () => {
		const map = fakeMaplibre(LEAF_LAYERS);
		const eventBus = fakeEventBus();
		const pluginConfig = { datasets: [DATASET], minZoom: 9, labelsOn: true };
		// the provider has no map yet - the app mounted before map:ready fired
		await renderInit({ pluginConfig, services: { eventBus }, mapProvider: {} });
		await waitFor(() => eventBus.listenerCount('map:ready') === 1);
		assert.equal(pluginConfig.mlMap, undefined);

		eventBus.emit('map:ready', { map });
		assert.equal(pluginConfig.mlMap, map);
		assert.ok(map.layers.get(LABEL_0));
		const idleCalls = map.on.mock.calls.length;

		eventBus.emit('map:ready', { map });
		assert.equal(map.on.mock.calls.length, idleCalls); // re-reporting the same map re-attaches nothing

		// a Layers-panel toggle hides a sublayer; datasets:changed resyncs its label
		map.setLayoutProperty('consultee-areas-identified-0', 'visibility', 'none');
		eventBus.emit('datasets:changed', { datasets: [] });
		assert.equal(map.layers.get(LABEL_0).layout.visibility, 'none');
		eventBus.emit('datasets:ready', {});
		assert.equal(map.layers.get(LABEL_0).layout.visibility, 'none'); // still hidden - same sublayer state
	});

	test('tolerates missing services and a map:ready without a map', async () => {
		const eventBus = fakeEventBus();
		await renderInit({ pluginConfig: { datasets: [DATASET] }, mapProvider: {} });
		const emptyContainer = await renderInit({ pluginConfig: { datasets: [DATASET] }, services: {}, mapProvider: {} });
		const pluginConfig = { datasets: [DATASET], minZoom: 9, labelsOn: true };
		await renderInit({ pluginConfig, services: { eventBus }, mapProvider: {} });
		await waitFor(() => eventBus.listenerCount('map:ready') === 1);
		eventBus.emit('map:ready', undefined); // a payload with no map attaches nothing
		eventBus.emit('map:ready', {});
		assert.equal(pluginConfig.mlMap, undefined);
		// cleanup with nothing attached detaches nothing
		compat.render(null, emptyContainer);
		await flushEffects();
	});

	test('attaches nothing without a pluginConfig, and still answers map events', async () => {
		const map = fakeMaplibre(LEAF_LAYERS);
		const eventBus = fakeEventBus();
		await renderInit({ services: { eventBus }, mapProvider: { map } });
		await waitFor(() => eventBus.listenerCount('datasets:ready') === 1);
		eventBus.emit('map:ready', { map });
		eventBus.emit('datasets:ready', {});
		assert.equal(map.addLayer.mock.calls.length, 0); // no pluginConfig - nothing to label
	});

	test('renders nothing when the bundle has no preact', () => {
		delete globalThis.preactCompat;
		assert.equal(ConsulteeLabelsInit({}), null);
	});
});

describe('createConsulteeLabelsPlugin', () => {
	test('defaults', () => {
		const plugin = createConsulteeLabelsPlugin();
		assert.equal(plugin.id, 'consulteeLabels');
		assert.deepEqual(plugin.datasets, []);
		assert.equal(plugin.datasetId, 'consultee-areas');
		assert.equal(plugin.minZoom, DEFAULT_LABEL_MIN_ZOOM);
		assert.equal(plugin.labelsOn, true);
		assert.equal(plugin.mlMap, undefined);
	});

	test('honours the configured options, including a zero zoom', () => {
		const datasets = [DATASET];
		const plugin = createConsulteeLabelsPlugin({
			datasets,
			datasetId: 'nearby-nsips',
			minZoom: 0,
			labelsOn: false,
			buttonLabel: 'Names'
		});
		assert.equal(plugin.datasets, datasets);
		assert.equal(plugin.datasetId, 'nearby-nsips');
		assert.equal(plugin.minZoom, 0);
		assert.equal(plugin.labelsOn, false);
		assert.equal(plugin.buttonLabel, 'Names');
	});

	test('a non-numeric minZoom falls back to the default', () => {
		assert.equal(createConsulteeLabelsPlugin({ minZoom: '8' }).minZoom, DEFAULT_LABEL_MIN_ZOOM);
	});

	test('the manifest wires the toggle button, reducer, icon and init component', async () => {
		const manifest = await createConsulteeLabelsPlugin({ labelsOn: true }).load();
		assert.equal(manifest.InitComponent, ConsulteeLabelsInit);
		assert.equal(manifest.reducer.initialState.labelsOn, true);
		assert.deepEqual(manifest.reducer.actions.SET_LABELS_ON({ labelsOn: true }, false), { labelsOn: false });
		assert.equal(manifest.icons.length, 1);
		assert.equal(manifest.icons[0].id, 'app-consultee-labels');

		const [button] = manifest.buttons;
		assert.equal(button.id, 'consulteeLabels');
		assert.equal(button.iconId, 'app-consultee-labels');
		for (const slot of ['mobile', 'tablet', 'desktop']) {
			assert.equal(button[slot].slot, 'top-left');
			assert.equal(button[slot].showLabel, true);
		}
		assert.equal(button.label({ pluginConfig: {} }), 'Consultee names');
		assert.equal(button.label({ pluginConfig: { buttonLabel: 'Names' } }), 'Names');
		assert.equal(button.label({}), 'Consultee names');
		assert.equal(button.pressedWhen({ pluginState: { labelsOn: true } }), true);
		assert.equal(button.pressedWhen({ pluginState: { labelsOn: false } }), false);
		assert.equal(button.pressedWhen({}), true);

		// the click delegates to the toggle - the shared flag lands on the map
		const map = fakeMaplibre(LEAF_LAYERS);
		button.onClick(null, { pluginConfig: { datasets: [DATASET], labelsOn: true }, mapProvider: { map } });
		assert.equal(map.consulteeLabelsOn, false);
	});

	test('the button starts unpressed when the plugin starts with labels off', async () => {
		const manifest = await createConsulteeLabelsPlugin({ labelsOn: false }).load();
		assert.equal(manifest.reducer.initialState.labelsOn, false);
		assert.equal(manifest.buttons[0].pressedWhen({ pluginState: manifest.reducer.initialState }), false);
	});
});
