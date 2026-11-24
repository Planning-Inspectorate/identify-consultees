import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import {
	basemapOptions,
	buildBufferSublayers,
	buildCategorySublayers,
	buildDatasets,
	buildSelectableLayers,
	buildSnapLayers,
	initAllConsulteeMaps,
	initConsulteeMap,
	interactiveZoom,
	readMapConfig,
	registerConsulteeMaps,
	translucent
} from './consultees-map.js';

function installDom(html = '<!DOCTYPE html><html><body></body></html>') {
	const dom = new JSDOM(html);
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.HTMLScriptElement = dom.window.HTMLScriptElement;
	globalThis.MutationObserver = dom.window.MutationObserver;
	return dom;
}

afterEach(() => {
	delete globalThis.window;
	delete globalThis.document;
	delete globalThis.HTMLElement;
	delete globalThis.HTMLScriptElement;
	delete globalThis.MutationObserver;
	delete globalThis.defra;
});

describe('consultees-map client helpers', () => {
	test('readMapConfig returns null for missing or invalid script tags', () => {
		installDom('<!DOCTYPE html><html><body><div id="map-a-data"></div></body></html>');
		assert.equal(readMapConfig('map-a'), null);

		installDom(
			`<!DOCTYPE html><html><body><script id="map-b-data" type="application/json">{bad</script></body></html>`
		);
		assert.equal(readMapConfig('map-b'), null);
	});

	test('readMapConfig parses JSON from a script element', () => {
		installDom(
			`<!DOCTYPE html><html><body><script id="map-c-data" type="application/json">{"zoom":8}</script></body></html>`
		);
		assert.deepEqual(readMapConfig('map-c'), { zoom: 8 });
	});

	test('readMapConfig prefers the script text property when set', () => {
		const dom = installDom('<!DOCTYPE html><html><body></body></html>');
		const script = dom.window.document.createElement('script');
		script.id = 'map-text-data';
		script.type = 'application/json';
		script.text = '{"zoom":9}';
		dom.window.document.body.appendChild(script);
		assert.deepEqual(readMapConfig('map-text'), { zoom: 9 });
	});

	test('readMapConfig falls back to textContent then empty string', () => {
		const dom = installDom('<!DOCTYPE html><html><body></body></html>');
		const withTextContent = dom.window.document.createElement('script');
		withTextContent.id = 'map-tc-data';
		withTextContent.type = 'application/json';
		withTextContent.textContent = '{"zoom":7}';
		Object.defineProperty(withTextContent, 'text', { configurable: true, get: () => '' });
		dom.window.document.body.appendChild(withTextContent);
		assert.deepEqual(readMapConfig('map-tc'), { zoom: 7 });

		const empty = dom.window.document.createElement('script');
		empty.id = 'map-empty-data';
		empty.type = 'application/json';
		Object.defineProperty(empty, 'text', { configurable: true, get: () => '' });
		Object.defineProperty(empty, 'textContent', { configurable: true, get: () => '' });
		dom.window.document.body.appendChild(empty);
		assert.equal(readMapConfig('map-empty'), null);
	});

	test('buildDatasets includes project and consultee layers when present', () => {
		const datasets = buildDatasets({
			projectGeojson: { features: [{ type: 'Feature' }] },
			consulteeGeojson: { features: [{ type: 'Feature' }] },
			projectLayerLabel: 'Project',
			consulteeLayerLabel: 'Consultees'
		});
		assert.deepEqual(
			datasets.map((dataset) => dataset.id),
			['consultee-areas', 'project-site']
		);
	});

	test('buildCategorySublayers gives each project drawn in its own colour a sublayer of its own, named for it', () => {
		const nsip = (id, name, colour) => ({
			type: 'Feature',
			properties: { consulteeCategory: 'NSIPs', consulteeId: id, name, colour, ownLayer: 'true' },
			geometry: { type: 'Polygon', coordinates: [] }
		});
		const sublayers = buildCategorySublayers(
			[nsip('b', 'Second Solar (EN010002)', '#f47738'), nsip('a', 'First Wind (EN010001)', '#1d70b8')],
			'nsips'
		);
		assert.deepEqual(
			sublayers.map(({ label, filter, style }) => [label, filter, style.stroke]),
			[
				['First Wind (EN010001)', ['==', ['get', 'consulteeId'], 'a'], '#1d70b8'],
				['Second Solar (EN010002)', ['==', ['get', 'consulteeId'], 'b'], '#f47738']
			]
		);
		// one with no name is still listed, under its category
		assert.equal(buildCategorySublayers([nsip('c', '', '#912b88')], 'nsips')[0].label, 'NSIPs');
	});

	test('buildDatasets fills the matches by category, one sublayer each, under the project site', () => {
		const point = (category, colour) => ({
			type: 'Feature',
			properties: { consulteeCategory: category, colour },
			geometry: { type: 'Point', coordinates: [0, 0] }
		});
		const area = (category, colour) => ({
			type: 'Feature',
			properties: { consulteeCategory: category, colour },
			geometry: { type: 'Polygon', coordinates: [] }
		});
		const datasets = buildDatasets({
			// a stale config's nearby layer is ignored - the map shows only the project and its matches
			nearbyGeojson: { features: [area('Police and crime commissioners', '#912b88')] },
			projectGeojson: { features: [{}] },
			consulteeGeojson: {
				features: [
					area('Parish, town and community councils', '#1d70b8'),
					point('Hospitals operated by NHS trusts and NHS foundation trusts (England)', '#f47738')
				]
			}
		});

		assert.deepEqual(
			datasets.map((dataset) => dataset.id),
			['consultee-areas', 'project-site']
		);
		const [matches] = datasets;

		assert.equal(matches.visible, undefined);
		assert.deepEqual(
			matches.sublayers.map((sublayer) => sublayer.label),
			[
				'Hospitals operated by NHS trusts and NHS foundation trusts (England) (1)',
				'Parish, town and community councils (1)'
			]
		);
		assert.deepEqual(matches.sublayers[0].filter, [
			'all',
			['==', ['get', 'consulteeCategory'], 'Hospitals operated by NHS trusts and NHS foundation trusts (England)'],
			['!=', ['get', 'identified'], 'false']
		]);
		// points as small circles
		assert.equal(matches.sublayers[0].style.symbol, 'circle');
		assert.match(matches.sublayers[0].style.symbolSvgContent, /{{haloColor}}/);
		// translucent fills - the plugin has no fill-opacity option, so it's in the colour
		assert.deepEqual(matches.sublayers[1].style, {
			stroke: '#1d70b8',
			strokeWidth: 2,
			fill: 'rgba(29, 112, 184, 0.35)'
		});
		assert.equal(matches.sublayers[0].style.symbolBackgroundColor, '#f47738');
	});

	test('buildCategorySublayers keys host and bordering authorities apart, hosts first, in their own colours', () => {
		const parish = (id, properties) => ({
			type: 'Feature',
			properties: { consulteeCategory: 'Parish, town and community councils', consulteeId: id, ...properties },
			geometry: { type: 'Polygon', coordinates: [] }
		});
		const sublayers = buildCategorySublayers(
			[
				parish('next door', { colour: '#f47738', authorityRole: 'bordering' }),
				parish('also next door', { colour: '#f47738', authorityRole: 'bordering' }),
				parish('in', { colour: '#007a7a', authorityRole: 'host' }),
				// one added by hand has no role - nor does nearby context, whatever it carries
				parish('added', { colour: '#28a197' }),
				parish('nearby', { colour: '#28a197', identified: 'false', authorityRole: 'host' }),
				{
					type: 'Feature',
					properties: { consulteeCategory: 'Railways', consulteeId: 'railway', colour: '#1d70b8' },
					geometry: { type: 'Polygon', coordinates: [] }
				}
			],
			'identified'
		);
		const byLabel = new Map(sublayers.map((sublayer) => [sublayer.label, sublayer]));
		const category = ['==', ['get', 'consulteeCategory'], 'Parish, town and community councils'];
		const identified = ['!=', ['get', 'identified'], 'false'];

		assert.deepEqual(
			sublayers.map(({ label, style }) => [label, style.stroke]),
			[
				['Parish, town and community councils: host (1)', '#007a7a'],
				['Parish, town and community councils: bordering (2)', '#f47738'],
				['Parish, town and community councils (1)', '#28a197'],
				['Parish, town and community councils: nearby, not identified (1)', '#28a197'],
				['Railways (1)', '#1d70b8']
			]
		);
		assert.deepEqual(byLabel.get('Parish, town and community councils: host (1)').filter, [
			'all',
			category,
			identified,
			['==', ['get', 'authorityRole'], 'host']
		]);
		assert.deepEqual(byLabel.get('Parish, town and community councils: bordering (2)').filter, [
			'all',
			category,
			identified,
			['==', ['get', 'authorityRole'], 'bordering']
		]);
		// the category's others take neither role's features
		assert.deepEqual(byLabel.get('Parish, town and community councils (1)').filter, [
			'all',
			category,
			identified,
			['!=', ['get', 'authorityRole'], 'host'],
			['!=', ['get', 'authorityRole'], 'bordering']
		]);
		// and a category with no roles filters as it always has
		assert.deepEqual(byLabel.get('Railways (1)').filter, [
			'all',
			['==', ['get', 'consulteeCategory'], 'Railways'],
			identified
		]);
	});

	test("buildCategorySublayers fills at each category's opacity, lightest first", () => {
		const sublayers = buildCategorySublayers(
			[
				{ properties: { consulteeCategory: 'Ambulance trusts', colour: '#1d70b8', fillOpacity: '0.35' } },
				{ properties: { consulteeCategory: 'Police and crime commissioners', colour: '#912b88', fillOpacity: '0.06' } }
			],
			'identified'
		);
		assert.deepEqual(
			sublayers.map((sublayer) => [sublayer.label, sublayer.style.fill]),
			[
				['Police and crime commissioners (1)', 'rgba(145, 43, 136, 0.06)'],
				['Ambulance trusts (1)', 'rgba(29, 112, 184, 0.35)']
			]
		);
	});

	test('buildCategorySublayers draws nearby-only consultees as their own fainter, dashed sublayer', () => {
		const sublayers = buildCategorySublayers(
			[
				{
					properties: {
						consulteeCategory: 'Parish, town and community councils',
						colour: '#28a197',
						fillOpacity: '0.35',
						identified: 'true'
					}
				},
				{
					properties: {
						consulteeCategory: 'Parish, town and community councils',
						colour: '#28a197',
						fillOpacity: '0.1',
						identified: 'false'
					}
				},
				{
					properties: {
						consulteeCategory: 'Parish, town and community councils',
						colour: '#28a197',
						fillOpacity: '0.1',
						identified: 'false'
					}
				},
				{
					geometry: { type: 'Point' },
					properties: {
						consulteeCategory: 'Hospitals operated by NHS trusts and NHS foundation trusts (England)',
						colour: '#d53880',
						fillOpacity: '0.1',
						identified: 'false'
					}
				}
			],
			'consultees'
		);

		assert.deepEqual(
			sublayers.map((sublayer) => [sublayer.label, sublayer.filter[2]]),
			[
				[
					'Hospitals operated by NHS trusts and NHS foundation trusts (England): nearby, not identified (1)',
					['==', ['get', 'identified'], 'false']
				],
				['Parish, town and community councils: nearby, not identified (2)', ['==', ['get', 'identified'], 'false']],
				['Parish, town and community councils (1)', ['!=', ['get', 'identified'], 'false']]
			]
		);
		// every sublayer, nearby context included, starts shown
		assert.ok(sublayers.every((sublayer) => sublayer.visible === true));
		const [hospitalDots, nearbyParishes, parishes] = sublayers.map((sublayer) => sublayer.style);
		assert.equal(hospitalDots.symbolBackgroundColor, 'rgba(213, 56, 128, 0.45)');
		assert.deepEqual(nearbyParishes, {
			stroke: '#28a197',
			strokeWidth: 1,
			strokeDashArray: [2, 2],
			fill: 'rgba(40, 161, 151, 0.1)'
		});
		assert.deepEqual(parishes, { stroke: '#28a197', strokeWidth: 2, fill: 'rgba(40, 161, 151, 0.35)' });
	});

	test('buildCategorySublayers groups uncategorised features and defaults missing colours', () => {
		const sublayers = buildCategorySublayers(
			[{ properties: { consulteeCategory: 'Police and crime commissioners' } }, { geometry: { type: 'Polygon' } }],
			'identified'
		);

		assert.deepEqual(
			sublayers.map((sublayer) => [sublayer.id, sublayer.label]),
			[
				['identified-0', 'Other (1)'],
				['identified-1', 'Police and crime commissioners (1)']
			]
		);
		assert.equal(sublayers[1].style.stroke, '#55A868');
	});

	test('translucent turns a hex colour into an rgba fill', () => {
		assert.equal(translucent('#ff0000', 0.2), 'rgba(255, 0, 0, 0.2)');
	});

	test("buildDatasets draws the ruleset's buffers dashed, under everything, with a sublayer per buffer", () => {
		const buffer = (label, metres, properties = {}) => ({
			type: 'Feature',
			properties: { label, metres, ...properties },
			geometry: { type: 'Polygon', coordinates: [] }
		});
		const datasets = buildDatasets({
			projectGeojson: { features: [{ type: 'Feature' }] },
			consulteeGeojson: { features: [{ type: 'Feature' }] },
			bufferGeojson: {
				features: [
					buffer('10 km', '10000'),
					buffer('1 km', '1000', { stroke: '#1d70b8', strokeWidth: '3', strokeDashArray: '[4, 2]' })
				]
			}
		});
		assert.deepEqual(
			datasets.map((dataset) => dataset.id),
			['ruleset-buffers', 'consultee-areas', 'project-site']
		);
		const [buffers] = datasets;
		assert.equal(buffers.label, 'Ruleset Buffers');
		assert.equal(buffers.idProperty, 'bufferId');
		// an outline alone - nothing filled to hide what's under it
		assert.deepEqual(buffers.style, { stroke: '#0b0c0c', strokeWidth: 2, strokeDashArray: [1, 1] });
		assert.deepEqual(buffers.sublayers, [
			{
				id: 'buffer-0',
				label: '1 km',
				visible: true,
				filter: ['==', ['get', 'label'], '1 km'],
				style: { stroke: '#1d70b8', strokeWidth: 3, strokeDashArray: [4, 2] }
			},
			{
				id: 'buffer-1',
				label: '10 km',
				visible: true,
				filter: ['==', ['get', 'label'], '10 km'],
				style: { stroke: '#0b0c0c', strokeWidth: 2, strokeDashArray: [1, 1] }
			}
		]);
		// none without any
		assert.ok(!buildDatasets({ bufferGeojson: { features: [] } }).some((dataset) => dataset.id === 'ruleset-buffers'));
	});

	test('buildBufferSublayers falls back to default label and style when feature properties are omitted', () => {
		const sublayers = buildBufferSublayers([{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] } }]);
		assert.deepEqual(sublayers, [
			{
				id: 'buffer-0',
				label: 'Ruleset buffer (0 km)',
				visible: true,
				filter: ['==', ['get', 'label'], 'Ruleset buffer (0 km)'],
				style: { stroke: '#0b0c0c', strokeWidth: 2, strokeDashArray: [1, 1] }
			}
		]);
	});

	test('buildDatasets orders shapefiles, ruleset buffers, consultee areas, and project site from bottom to top', () => {
		const feature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] } };
		const datasets = buildDatasets({
			shapefileDatasets: [{ id: 'file-a', label: 'a.geojson', geojson: { features: [feature] } }],
			bufferGeojson: { features: [feature] },
			consulteeGeojson: { features: [feature] },
			projectGeojson: { features: [feature] }
		});
		assert.deepEqual(
			datasets.map((dataset) => dataset.id),
			['file-a', 'ruleset-buffers', 'consultee-areas', 'project-site']
		);
	});
	test('buildDatasets omits empty collections', () => {
		assert.deepEqual(buildDatasets({ projectGeojson: { features: [] }, consulteeGeojson: null }), []);
	});

	test('buildDatasets lists each shapefile under the GIS shapefiles group, every one visible', () => {
		const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } };
		const datasets = buildDatasets({
			shapefileDatasets: [
				{ id: 'file-a', label: 'a.geojson', geojson: { features: [feature] } },
				{ id: 'file-b', label: 'b.geojson', geojson: { features: [feature] } },
				// a file with no geometry produces no dataset at all
				{ id: 'file-empty', label: 'empty.geojson', geojson: { features: [] } }
			]
		});

		assert.deepEqual(
			datasets.map((dataset) => [dataset.id, dataset.visible, dataset.groupLabel]),
			[
				['file-a', true, 'GIS shapefiles'],
				['file-b', true, 'GIS shapefiles']
			]
		);
		assert.equal(datasets[0].idProperty, 'fileKey');
		assert.equal(datasets[0].showInMenu, true);
	});

	test('buildDatasets honours a custom shapefile group label', () => {
		const datasets = buildDatasets({
			shapefileGroupLabel: 'Boundary submissions',
			shapefileDatasets: [{ id: 'file-a', label: 'a.geojson', geojson: { features: [{ type: 'Feature' }] } }]
		});
		assert.equal(datasets[0].groupLabel, 'Boundary submissions');
	});

	test('buildDatasets draws each shapefile in the style the page gives it, red without one', () => {
		const style = { stroke: '#1d70b8', strokeWidth: 2, strokeDashArray: [4, 2], fill: 'rgba(29, 112, 184, 0.15)' };
		const datasets = buildDatasets({
			shapefileDatasets: [
				{ id: 'file-a', label: 'a.geojson', style, geojson: { features: [{ type: 'Feature' }] } },
				{ id: 'file-b', label: 'b.geojson', geojson: { features: [{ type: 'Feature' }] } }
			]
		});

		assert.deepEqual(datasets[0].style, style);
		assert.equal(datasets[1].style.stroke, '#ff0000');
	});

	test('buildSelectableLayers lists each shapefile dataset as selectable', () => {
		const layers = buildSelectableLayers(
			buildDatasets({
				shapefileDatasets: [
					{
						id: 'file-a',
						label: 'a.geojson',
						checked: true,
						geojson: { features: [{ type: 'Feature' }] }
					}
				]
			})
		);

		assert.deepEqual(
			layers.map((layer) => `${layer.layerId}:${layer.idProperty}`),
			['file-a:fileKey', 'file-a-stroke:fileKey']
		);
	});

	test('initConsulteeMap falls back when Defra is unavailable', () => {
		const dom = installDom(
			`<!DOCTYPE html><html><body>
				<div id="map-1" class="app-consultee-map"></div>
				<script id="map-1-data" type="application/json">{"center":[0,0],"zoom":8,"height":400,"mapLabel":"Map","projectGeojson":{"features":[{"type":"Feature"}]},"consulteeGeojson":{"features":[]},"fallback":{"src":"/s.png"}}</script>
			</body></html>`
		);
		initConsulteeMap('missing');
		initConsulteeMap('map-1');
		assert.ok(dom.window.document.querySelector('img.app-case-map-static'));
	});

	test('initConsulteeMap constructs an InteractiveMap when Defra is present', () => {
		installDom(
			`<!DOCTYPE html><html><body>
				<div id="map-2" class="app-consultee-map"></div>
				<script id="map-2-data" type="application/json">{"center":[0,0],"zoom":8,"projectGeojson":{"features":[{"type":"Feature"}]},"consulteeGeojson":{"features":[{"type":"Feature"}]}}</script>
			</body></html>`
		);

		const InteractiveMap = mock.fn(function InteractiveMap() {});
		const defra = {
			InteractiveMap,
			maplibreProvider: mock.fn(() => ({})),
			datasetsPlugin: mock.fn(() => ({})),
			mapKeyPlugin: mock.fn(() => ({}))
		};
		globalThis.defra = defra;
		globalThis.window.defra = defra;

		initConsulteeMap('map-2');
		assert.equal(InteractiveMap.mock.callCount(), 1);
		// the built-in menu stays hidden - the layers-key plugin draws the toggles
		// itself, so the map-key bundle is never needed
		assert.equal(defra.datasetsPlugin.mock.calls[0].arguments[0].hasMenu, false);
		assert.equal(defra.mapKeyPlugin.mock.callCount(), 0);
		// the page's zoom 8 is on 256px raster tiles - MapLibre's 512px levels count one fewer
		assert.equal(InteractiveMap.mock.calls[0].arguments[1].zoom, 7);

		// the static-map fallback is registered as a plugin, carrying the page's
		// fallback config for the failure paths the map can't reach itself
		const plugins = InteractiveMap.mock.calls[0].arguments[1].plugins;
		const staticMap = plugins.find((plugin) => plugin.id === 'staticMap');
		assert.ok(staticMap);
		assert.equal(typeof staticMap.load, 'function');
		assert.ok(plugins.some((plugin) => plugin.id === 'layersKey'));
		// so is the loading overlay, dismissed at map:firstidle
		assert.ok(plugins.find((plugin) => plugin.id === 'mapLoading'));
		assert.ok(plugins.some((plugin) => plugin.id === 'featureDetails'));
		// the measure tool needs the draw bundle, which this page's scripts omit - so neither registers
		assert.ok(!plugins.some((plugin) => plugin.id === 'measure'));
		// and the plugin mirroring the consultees table's selected row with the map
		assert.ok(plugins.some((plugin) => plugin.id === 'featureRowSelect'));
	});

	test('initConsulteeMap registers the draw and measure plugins when the draw bundle is loaded', () => {
		installDom(
			`<!DOCTYPE html><html><body>
				<div id="map-measure" class="app-consultee-map"></div>
				<script id="map-measure-data" type="application/json">{"center":[0,0],"zoom":8,"projectGeojson":{"features":[{"type":"Feature"}]}}</script>
			</body></html>`
		);

		const draw = { id: 'draw' };
		const drawPlugin = mock.fn(() => draw);
		const interact = { enable: mock.fn(), disable: mock.fn(), clear: mock.fn() };
		const interactPlugin = mock.fn(() => interact);
		const handlers = {};
		const map = {
			on: (event, handler) => {
				(handlers[event] ??= []).push(handler);
			}
		};
		const InteractiveMap = mock.fn(function InteractiveMap() {
			return map;
		});
		globalThis.defra = {
			InteractiveMap,
			maplibreProvider: mock.fn(() => ({})),
			datasetsPlugin: mock.fn(() => ({})),
			drawPlugin,
			interactPlugin
		};
		globalThis.window.defra = globalThis.defra;

		initConsulteeMap('map-measure');
		assert.equal(drawPlugin.mock.callCount(), 1);

		// the draw plugin gets the map's selectable layers as snap targets, so the
		// draw panel's "Snap to feature" toggle is offered in measure sessions
		assert.deepEqual(drawPlugin.mock.calls[0].arguments[0].snapLayers, ['project-site', 'project-site-stroke']);

		// draw registers ahead of measure - the measure plugin draws through its adapter
		const plugins = InteractiveMap.mock.calls[0].arguments[1].plugins;
		assert.ok(plugins.indexOf(draw) > -1);
		const measure = plugins.find((plugin) => plugin.id === 'measure');
		assert.ok(measure);
		assert.ok(plugins.indexOf(draw) < plugins.indexOf(measure));
		assert.deepEqual(measure.modes, ['distance', 'path', 'area']);

		// a measure session suspends feature selection so vertex clicks stop picking
		// the consultee area under them - the pickers come back when it ends
		for (const handler of handlers['draw:started'] ?? []) {
			handler();
		}
		assert.equal(interact.disable.mock.callCount(), 1);
		for (const handler of handlers['draw:created'] ?? []) {
			handler();
		}
		assert.equal(interact.enable.mock.callCount(), 1);
		for (const handler of handlers['draw:cancelled'] ?? []) {
			handler();
		}
		assert.equal(interact.enable.mock.callCount(), 2);

		// editing a finished measurement suspends selection the same way
		for (const handler of handlers['draw:editstart'] ?? []) {
			handler();
		}
		assert.equal(interact.disable.mock.callCount(), 2);
		for (const handler of handlers['draw:edited'] ?? []) {
			handler();
		}
		assert.equal(interact.enable.mock.callCount(), 3);
	});

	test('buildSelectableLayers lists the MapLibre layers of each consultee sublayer and the project site', () => {
		const area = {
			properties: { consulteeCategory: 'Police and crime commissioners', colour: '#1d70b8' },
			geometry: { type: 'Polygon' }
		};
		const layers = buildSelectableLayers(
			buildDatasets({
				consulteeGeojson: { features: [area] },
				projectGeojson: { features: [{}] }
			})
		);

		assert.deepEqual(
			layers.map((layer) => `${layer.layerId}:${layer.idProperty}`),
			[
				'consultee-areas-identified-0:consulteeId',
				'consultee-areas-identified-0-stroke:consulteeId',
				'project-site:reference',
				'project-site-stroke:reference'
			]
		);
		assert.ok(layers.every((layer) => layer.labelProperty === 'name'));
	});

	test('buildSnapLayers reuses the selectable layer ids as snap targets', () => {
		const area = {
			properties: { consulteeCategory: 'Police and crime commissioners', colour: '#1d70b8' },
			geometry: { type: 'Polygon' }
		};
		const datasets = buildDatasets({
			consulteeGeojson: { features: [area] },
			projectGeojson: { features: [{}] }
		});
		assert.deepEqual(
			buildSnapLayers(datasets),
			buildSelectableLayers(datasets).map((layer) => layer.layerId)
		);
		assert.deepEqual(buildSnapLayers([]), []);
	});

	test('initConsulteeMap shows a selected feature in a panel, and clears the selection when it closes', () => {
		installDom(
			`<!DOCTYPE html><html><body>
				<div id="map-4" class="app-consultee-map"></div>
				<script id="map-4-data" type="application/json">{"center":[0,0],"zoom":8,"projectGeojson":{"features":[{"type":"Feature"}]}}</script>
			</body></html>`
		);
		const handlers = {};
		const fire = (event, payload) => {
			for (const handler of handlers[event] ?? []) {
				handler(payload);
			}
		};
		const map = {
			on: (event, handler) => {
				(handlers[event] ??= []).push(handler);
			},
			addPanel: mock.fn((id, options) => {
				document.body.insertAdjacentHTML('beforeend', options.html);
			}),
			showPanel: mock.fn(),
			hidePanel: mock.fn()
		};
		const interact = { enable: mock.fn(), clear: mock.fn() };
		const interactPlugin = mock.fn(() => interact);
		globalThis.defra = {
			InteractiveMap: function InteractiveMap() {
				return map;
			},
			maplibreProvider: mock.fn(() => ({})),
			datasetsPlugin: mock.fn(() => ({})),
			mapKeyPlugin: mock.fn(() => ({})),
			interactPlugin
		};
		globalThis.window.defra = globalThis.defra;

		initConsulteeMap('map-4');
		assert.deepEqual(interactPlugin.mock.calls[0].arguments[0].interactionModes, ['selectFeature']);

		// the loading overlay covers the container until the map first idles
		assert.ok(document.querySelector('.app-map-loading'));
		fire('map:firstidle');
		// dismissal starts the overlay's fade-out; the plugin's own spec covers
		// the removal once the fade has played
		assert.ok(document.querySelector('.app-map-loading').classList.contains('app-map-loading--leaving'));

		fire('map:ready');
		assert.equal(interact.enable.mock.callCount(), 1);
		assert.equal(map.addPanel.mock.calls[0].arguments[0], 'consultee-details');
		assert.equal(map.hidePanel.mock.callCount(), 1);

		fire('interact:selectionchange', {
			selectedFeatures: [
				{ properties: { consulteeId: 'x', name: 'Offley', consulteeCategory: 'Parish, town and community councils' } }
			]
		});
		assert.equal(map.showPanel.mock.callCount(), 1);
		assert.match(document.getElementById('consultee-details-content').innerHTML, /Offley/);

		fire('interact:selectionchange', { selectedFeatures: [] });
		assert.equal(map.hidePanel.mock.callCount(), 2);

		fire('app:panelclosed', { panelId: 'some-other-panel' });
		assert.equal(interact.clear.mock.callCount(), 0);
		fire('app:panelclosed', { panelId: 'consultee-details' });
		assert.equal(interact.clear.mock.callCount(), 1);
	});

	test('initConsulteeMap falls back when InteractiveMap throws', () => {
		const dom = installDom(
			`<!DOCTYPE html><html><body>
				<div id="map-3" class="app-consultee-map"></div>
				<script id="map-3-data" type="application/json">{"center":[0,0],"zoom":8,"projectGeojson":{"features":[{"type":"Feature"}]},"fallback":{"src":"/fallback.png"}}</script>
			</body></html>`
		);

		// no mapKeyPlugin on purpose - a page without the bundle must still init
		globalThis.defra = {
			InteractiveMap: mock.fn(() => {
				throw new Error('boom');
			}),
			maplibreProvider: mock.fn(() => ({})),
			datasetsPlugin: mock.fn(() => ({}))
		};
		globalThis.window.defra = globalThis.defra;

		initConsulteeMap('map-3');
		assert.ok(dom.window.document.querySelector('img.app-case-map-static'));
	});

	test('registerConsulteeMaps runs immediately or on DOMContentLoaded', () => {
		const dom = installDom(
			'<!DOCTYPE html><html><body><div id="map-4" class="app-consultee-map"></div><script id="map-4-data" type="application/json">{"center":[0,0],"zoom":8}</script></body></html>'
		);
		Object.defineProperty(dom.window.document, 'readyState', { configurable: true, get: () => 'complete' });
		registerConsulteeMaps(dom.window.document);
		initAllConsulteeMaps();

		const loadingDom = installDom('<!DOCTYPE html><html><body></body></html>');
		Object.defineProperty(loadingDom.window.document, 'readyState', {
			configurable: true,
			get: () => 'loading'
		});
		const addEventListener = mock.fn();
		loadingDom.window.document.addEventListener = addEventListener;
		registerConsulteeMaps(loadingDom.window.document);
		assert.equal(addEventListener.mock.callCount(), 1);

		registerConsulteeMaps(undefined);
	});

	test("basemapOptions draws on OS's style through the app, within its zooms and area, else OpenFreeMap", () => {
		globalThis.window = new JSDOM('', { url: 'https://consultees.example.test/consultees/EN010001' }).window;
		const freeMapStyle = basemapOptions(undefined).mapStyle;
		assert.equal(freeMapStyle.url, 'https://tiles.openfreemap.org/styles/liberty');
		// the draw adapter builds `user_fill<id>` expressions off mapStyle.id
		assert.equal(freeMapStyle.id, 'openfreemap');
		const os = {
			id: 'os-light',
			url: '/maps/os/style.json',
			attribution: '© Crown copyright and database rights 2026 OS',
			backgroundColor: '#f5f5f5',
			minZoom: 6,
			maxZoom: 19,
			maxExtent: [-10.7, 49.5, 1.9, 61.3]
		};
		assert.deepEqual(basemapOptions(os), {
			mapStyle: {
				id: 'os-light',
				url: 'https://consultees.example.test/maps/os/style.json',
				attribution: os.attribution,
				backgroundColor: os.backgroundColor
			},
			minZoom: 6,
			maxZoom: 19,
			maxExtent: os.maxExtent
		});
		// a basemap without limits sets none
		assert.deepEqual(Object.keys(basemapOptions({ url: '/style.json', attribution: 'a', backgroundColor: '#fff' })), [
			'mapStyle'
		]);
	});

	test('interactiveZoom counts MapLibre zoom levels, on 512px tiles, from the page config', () => {
		assert.equal(interactiveZoom(12), 11);
		assert.equal(interactiveZoom(0), 0);
	});
});
