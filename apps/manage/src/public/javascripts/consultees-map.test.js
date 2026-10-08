import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import {
	buildCategorySublayers,
	buildDatasets,
	buildSelectableLayers,
	featureDetailsHtml,
	initAllConsulteeMaps,
	initConsulteeMap,
	readMapConfig,
	registerConsulteeMaps,
	showStaticMapFallback,
	translucent
} from './consultees-map.js';

function installDom(html = '<!DOCTYPE html><html><body></body></html>') {
	const dom = new JSDOM(html);
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.HTMLScriptElement = dom.window.HTMLScriptElement;
	return dom;
}

afterEach(() => {
	delete globalThis.window;
	delete globalThis.document;
	delete globalThis.HTMLElement;
	delete globalThis.HTMLScriptElement;
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

	test('buildDatasets fills the matches by category and hides the nearby outlines', () => {
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
			nearbyLayerLabel: 'All consultees within 20km',
			nearbyGeojson: {
				features: [
					area('Police', '#912b88'),
					point('Hospital', '#f47738'),
					point('Hospital', '#f47738'),
					area('Parish Council', '#1d70b8')
				]
			},
			projectGeojson: { features: [{}] },
			consulteeGeojson: { features: [area('Parish Council', '#1d70b8'), point('Hospital', '#f47738')] }
		});

		assert.deepEqual(
			datasets.map((dataset) => dataset.id),
			['nearby-consultees', 'consultee-areas', 'project-site']
		);
		const [nearby, matches] = datasets;

		assert.equal(nearby.visible, false);
		assert.equal(nearby.label, 'All consultees within 20km');
		assert.deepEqual(
			nearby.sublayers.map((sublayer) => sublayer.label),
			['Hospital (2)', 'Parish Council (1)', 'Police (1)']
		);
		assert.deepEqual(nearby.sublayers[0].filter, ['==', ['get', 'consulteeCategory'], 'Hospital']);
		// points as circles, areas as outlines in the category's colour
		assert.equal(nearby.sublayers[0].style.symbol, 'circle');
		assert.match(nearby.sublayers[0].style.symbolSvgContent, /{{haloColor}}/);
		assert.equal(nearby.sublayers[0].style.symbolBackgroundColor, '#f47738');
		assert.deepEqual(nearby.sublayers[1].style, { stroke: '#1d70b8', strokeWidth: 2, fill: 'transparent' });

		assert.equal(matches.visible, undefined);
		assert.deepEqual(
			matches.sublayers.map((sublayer) => sublayer.label),
			['Hospital (1)', 'Parish Council (1)']
		);
		// translucent fills - the plugin has no fill-opacity option, so it's in the colour
		assert.deepEqual(matches.sublayers[1].style, {
			stroke: '#1d70b8',
			strokeWidth: 2,
			fill: 'rgba(29, 112, 184, 0.35)'
		});
		assert.equal(matches.sublayers[0].style.symbolBackgroundColor, '#f47738');
	});

	test("buildCategorySublayers fills at each category's opacity, lightest first", () => {
		const sublayers = buildCategorySublayers(
			[
				{ properties: { consulteeCategory: 'Ambulance Trust', colour: '#1d70b8', fillOpacity: '0.35' } },
				{ properties: { consulteeCategory: 'Police', colour: '#912b88', fillOpacity: '0.06' } }
			],
			'identified',
			true
		);
		assert.deepEqual(
			sublayers.map((sublayer) => [sublayer.label, sublayer.style.fill]),
			[
				['Police (1)', 'rgba(145, 43, 136, 0.06)'],
				['Ambulance Trust (1)', 'rgba(29, 112, 184, 0.35)']
			]
		);
	});

	test('buildCategorySublayers groups uncategorised features and defaults missing colours', () => {
		const sublayers = buildCategorySublayers(
			[{ properties: { consulteeCategory: 'Police' } }, { geometry: { type: 'Polygon' } }],
			'identified',
			true
		);

		assert.deepEqual(
			sublayers.map((sublayer) => [sublayer.id, sublayer.label]),
			[
				['identified-0', 'Other (1)'],
				['identified-1', 'Police (1)']
			]
		);
		assert.equal(sublayers[1].style.stroke, '#55A868');
	});

	test('buildDatasets defaults the nearby label', () => {
		const [nearby] = buildDatasets({
			nearbyGeojson: { features: [{ properties: { consulteeCategory: 'Hospital' }, geometry: { type: 'Point' } }] }
		});
		assert.equal(nearby.label, 'All consultees nearby');
	});

	test('translucent turns a hex colour into an rgba fill', () => {
		assert.equal(translucent('#C44E52', 0.45), 'rgba(196, 78, 82, 0.45)');
	});

	test('buildDatasets omits empty collections', () => {
		assert.deepEqual(buildDatasets({ projectGeojson: { features: [] }, consulteeGeojson: null }), []);
	});

	test('showStaticMapFallback inserts an image when a static src is available', () => {
		const dom = installDom(
			'<!DOCTYPE html><html><body><div id="map" class="app-case-map-interactive"></div></body></html>'
		);
		const container = dom.window.document.getElementById('map');
		const fallback = { src: '/static.png', alt: 'Alt', width: 320, height: 200 };
		showStaticMapFallback(container, fallback);
		assert.ok(container.querySelector('img.app-case-map-static'));
		assert.equal(container.classList.contains('app-case-map-interactive'), false);
		assert.match(container.nextElementSibling?.textContent || '', /static map/i);

		showStaticMapFallback(container, fallback);
		assert.equal(container.querySelectorAll('img.app-case-map-static').length, 1);
	});

	test('showStaticMapFallback shows text when no static src is available', () => {
		const dom = installDom('<!DOCTYPE html><html><body><div id="map"></div></body></html>');
		const container = dom.window.document.getElementById('map');
		showStaticMapFallback(container, undefined);
		assert.match(container.textContent || '', /could not load/i);
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
	});

	test('buildSelectableLayers lists the MapLibre layers of each consultee sublayer and the project site', () => {
		const area = { properties: { consulteeCategory: 'Police', colour: '#1d70b8' }, geometry: { type: 'Polygon' } };
		const layers = buildSelectableLayers(
			buildDatasets({
				nearbyGeojson: { features: [area] },
				consulteeGeojson: { features: [area] },
				projectGeojson: { features: [{}] }
			})
		);

		assert.deepEqual(
			layers.map((layer) => `${layer.layerId}:${layer.idProperty}`),
			[
				'nearby-consultees-nearby-0:consulteeId',
				'nearby-consultees-nearby-0-stroke:consulteeId',
				'consultee-areas-identified-0:consulteeId',
				'consultee-areas-identified-0-stroke:consulteeId',
				'project-site:reference',
				'project-site-stroke:reference'
			]
		);
		assert.ok(layers.every((layer) => layer.labelProperty === 'name'));
	});

	test('featureDetailsHtml describes a consultee or the project site, escaping their text', () => {
		assert.equal(
			featureDetailsHtml({ consulteeId: 'x', name: 'A & <B>', consulteeCategory: 'Police', region: 'East' }),
			'<p class="govuk-body govuk-!-font-weight-bold govuk-!-margin-bottom-2">A &amp; &lt;B&gt;</p>' +
				'<p class="govuk-body-s govuk-!-margin-bottom-1">Category: Police</p>' +
				'<p class="govuk-body-s govuk-!-margin-bottom-1">Region: East</p>'
		);
		assert.match(
			featureDetailsHtml({ consulteeId: 'x', name: '', consulteeCategory: 'Hospital', region: '' }),
			/Unnamed.*Category: Hospital<\/p>$/
		);
		assert.match(featureDetailsHtml({ name: 'Luton', reference: 'TR020001' }), /Luton.*Reference: TR020001/);
	});

	test('initConsulteeMap shows a selected feature in a panel, and clears the selection when it closes', () => {
		installDom(
			`<!DOCTYPE html><html><body>
				<div id="map-4" class="app-consultee-map"></div>
				<script id="map-4-data" type="application/json">{"center":[0,0],"zoom":8,"projectGeojson":{"features":[{"type":"Feature"}]}}</script>
			</body></html>`
		);
		const handlers = {};
		const map = {
			on: (event, handler) => {
				handlers[event] = handler;
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

		handlers['map:ready']();
		assert.equal(interact.enable.mock.callCount(), 1);
		assert.equal(map.addPanel.mock.calls[0].arguments[0], 'consultee-details');
		assert.equal(map.hidePanel.mock.callCount(), 1);

		handlers['interact:selectionchange']({
			selectedFeatures: [{ properties: { consulteeId: 'x', name: 'Offley', consulteeCategory: 'Parish Council' } }]
		});
		assert.equal(map.showPanel.mock.callCount(), 1);
		assert.match(document.getElementById('consultee-details-content').innerHTML, /Offley/);

		handlers['interact:selectionchange']({ selectedFeatures: [] });
		assert.equal(map.hidePanel.mock.callCount(), 2);

		handlers['app:panelclosed']({ panelId: 'some-other-panel' });
		assert.equal(interact.clear.mock.callCount(), 0);
		handlers['app:panelclosed']({ panelId: 'consultee-details' });
		assert.equal(interact.clear.mock.callCount(), 1);
	});

	test('initConsulteeMap falls back when InteractiveMap throws', () => {
		const dom = installDom(
			`<!DOCTYPE html><html><body>
				<div id="map-3" class="app-consultee-map"></div>
				<script id="map-3-data" type="application/json">{"center":[0,0],"zoom":8,"projectGeojson":{"features":[{"type":"Feature"}]},"fallback":{"src":"/fallback.png"}}</script>
			</body></html>`
		);

		globalThis.defra = {
			InteractiveMap: mock.fn(() => {
				throw new Error('boom');
			}),
			maplibreProvider: mock.fn(() => ({})),
			datasetsPlugin: mock.fn(() => ({})),
			mapKeyPlugin: mock.fn(() => ({}))
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
});
