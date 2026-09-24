import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import {
	buildDatasets,
	initAllConsulteeMaps,
	initConsulteeMap,
	readMapConfig,
	registerConsulteeMaps,
	showStaticMapFallback
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
