import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import {
	buildDatasets,
	buildNearbySublayers,
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
			['project-site', 'consultee-areas']
		);
	});

	test('buildDatasets puts the nearby consultees layer first, with a sublayer per category', () => {
		const point = (category) => ({
			type: 'Feature',
			properties: { consulteeCategory: category },
			geometry: { type: 'Point', coordinates: [0, 0] }
		});
		const area = (category) => ({
			type: 'Feature',
			properties: { consulteeCategory: category },
			geometry: { type: 'Polygon', coordinates: [] }
		});
		const datasets = buildDatasets({
			searchAreaLabel: 'Search area (20km)',
			searchAreaGeojson: { features: [{}] },
			nearbyLayerLabel: 'All consultees within 20km',
			nearbyGeojson: { features: [area('Police'), point('Hospital'), point('Hospital'), area('Parish Council')] },
			projectGeojson: { features: [{}] },
			consulteeGeojson: { features: [{}] }
		});

		assert.deepEqual(
			datasets.map((dataset) => dataset.id),
			['search-area', 'nearby-consultees', 'project-site', 'consultee-areas']
		);
		const [searchArea, nearby, , matches] = datasets;
		assert.equal(searchArea.label, 'Search area (20km)');
		assert.deepEqual(searchArea.style.strokeDashArray, [4, 3]);
		// translucent fills - the plugin has no fill-opacity option, so it's in the colour
		assert.equal(matches.style.fill, 'rgba(85, 168, 104, 0.05)');
		assert.equal(nearby.label, 'All consultees within 20km');
		assert.deepEqual(
			nearby.sublayers.map((sublayer) => sublayer.label),
			['Hospital (2)', 'Parish Council (1)', 'Police (1)']
		);
		assert.deepEqual(nearby.sublayers[0].filter, ['==', ['get', 'consulteeCategory'], 'Hospital']);
		// points as circles, areas as outlines
		assert.equal(nearby.sublayers[0].style.symbol, 'circle');
		assert.match(nearby.sublayers[0].style.symbolSvgContent, /{{haloColor}}/);
		assert.equal(nearby.sublayers[1].style.fill, 'transparent');
		assert.ok(nearby.sublayers[1].style.stroke);
	});

	test('buildNearbySublayers groups uncategorised areas and cycles colours past the palette', () => {
		const features = Array.from({ length: 12 }, (_, i) => ({
			properties: { consulteeCategory: `Category ${String(i).padStart(2, '0')}` },
			geometry: { type: 'Polygon' }
		}));
		features.push({ properties: {}, geometry: { type: 'Polygon' } });
		const sublayers = buildNearbySublayers(features);

		assert.equal(sublayers.length, 13);
		assert.equal(sublayers.at(-1).label, 'Other (1)');
		assert.equal(sublayers[0].style.stroke, sublayers[10].style.stroke);
		assert.notEqual(sublayers[0].style.stroke, sublayers[1].style.stroke);
	});

	test('buildDatasets defaults the nearby and search area labels', () => {
		const [searchArea, nearby] = buildDatasets({
			searchAreaGeojson: { features: [{}] },
			nearbyGeojson: { features: [{ properties: { consulteeCategory: 'Hospital' }, geometry: { type: 'Point' } }] }
		});
		assert.equal(searchArea.label, 'Search area');
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
			'<!DOCTYPE html><html><body><div id="map" data-static-map-src="/static.png" data-static-map-alt="Alt" data-map-width="320" data-map-height="200" class="app-case-map-interactive"></div></body></html>'
		);
		const container = dom.window.document.getElementById('map');
		showStaticMapFallback(container);
		assert.ok(container.querySelector('img.app-case-map-static'));
		assert.equal(container.classList.contains('app-case-map-interactive'), false);
		assert.match(container.nextElementSibling?.textContent || '', /static map/i);

		showStaticMapFallback(container);
		assert.equal(container.querySelectorAll('img.app-case-map-static').length, 1);
	});

	test('showStaticMapFallback shows text when no static src is available', () => {
		const dom = installDom('<!DOCTYPE html><html><body><div id="map"></div></body></html>');
		const container = dom.window.document.getElementById('map');
		showStaticMapFallback(container);
		assert.match(container.textContent || '', /could not load/i);
	});

	test('initConsulteeMap falls back when Defra is unavailable', () => {
		const dom = installDom(
			`<!DOCTYPE html><html><body>
				<div id="map-1" data-consultee-map data-static-map-src="/s.png"></div>
				<script id="map-1-data" type="application/json">{"center":[0,0],"zoom":8,"height":400,"mapLabel":"Map","projectGeojson":{"features":[{"type":"Feature"}]},"consulteeGeojson":{"features":[]}}</script>
			</body></html>`
		);
		initConsulteeMap('missing');
		initConsulteeMap('map-1');
		assert.ok(dom.window.document.querySelector('img.app-case-map-static'));
	});

	test('initConsulteeMap constructs an InteractiveMap when Defra is present', () => {
		installDom(
			`<!DOCTYPE html><html><body>
				<div id="map-2" data-consultee-map></div>
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

	test('initConsulteeMap falls back when InteractiveMap throws', () => {
		const dom = installDom(
			`<!DOCTYPE html><html><body>
				<div id="map-3" data-consultee-map data-static-map-src="/fallback.png"></div>
				<script id="map-3-data" type="application/json">{"center":[0,0],"zoom":8,"projectGeojson":{"features":[{"type":"Feature"}]}}</script>
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
			'<!DOCTYPE html><html><body><div id="map-4" data-consultee-map></div><script id="map-4-data" type="application/json">{"center":[0,0],"zoom":8}</script></body></html>'
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
