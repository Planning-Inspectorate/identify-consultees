import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import {
	buildDatasets,
	initAllMapLayersDemos,
	initMapLayersDemo,
	readMapConfig,
	registerMapLayersDemo,
	showMapUnavailable
} from './map-layers-demo.js';

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

describe('map-layers-demo client helpers', () => {
	test('buildDatasets creates four toggleable datasets when all overlays are present', () => {
		const datasets = buildDatasets({
			projectGeojson: { type: 'FeatureCollection', features: [{ type: 'Feature' }] },
			railwayGeojson: { type: 'FeatureCollection', features: [{ type: 'Feature' }] },
			roadGeojson: { type: 'FeatureCollection', features: [{ type: 'Feature' }] },
			constraintGeojson: { type: 'FeatureCollection', features: [{ type: 'Feature' }] },
			projectLayerLabel: 'Project site',
			railwayLayerLabel: 'Railway lines',
			roadLayerLabel: 'Road network',
			constraintLayerLabel: 'Flood risk area'
		});

		assert.equal(datasets.length, 4);
		assert.deepEqual(
			datasets.map((dataset) => dataset.id),
			['project-site', 'railways', 'roads', 'constraints']
		);
		for (const dataset of datasets) {
			assert.equal(dataset.showInMenu, true);
			assert.equal(dataset.showInKey, true);
		}
	});

	test('buildDatasets omits empty overlay collections', () => {
		const datasets = buildDatasets({
			projectGeojson: { type: 'FeatureCollection', features: [{ type: 'Feature' }] },
			railwayGeojson: { type: 'FeatureCollection', features: [] },
			roadGeojson: null,
			constraintGeojson: { type: 'FeatureCollection', features: [{ type: 'Feature' }] }
		});

		assert.deepEqual(
			datasets.map((dataset) => dataset.id),
			['project-site', 'constraints']
		);
	});

	test('readMapConfig parses valid JSON and rejects invalid markup', () => {
		installDom('<!DOCTYPE html><html><body><div id="demo-data"></div></body></html>');
		assert.equal(readMapConfig('demo'), null);

		installDom(
			`<!DOCTYPE html><html><body><script id="demo-data" type="application/json">{nope</script></body></html>`
		);
		assert.equal(readMapConfig('demo'), null);

		installDom(
			`<!DOCTYPE html><html><body><script id="demo-data" type="application/json">{"zoom":11}</script></body></html>`
		);
		assert.deepEqual(readMapConfig('demo'), { zoom: 11 });
	});

	test('showMapUnavailable replaces the container contents', () => {
		const dom = installDom(
			'<!DOCTYPE html><html><body><div id="demo" class="app-case-map-interactive">x</div></body></html>'
		);
		const container = dom.window.document.getElementById('demo');
		showMapUnavailable(container);
		assert.equal(container.classList.contains('app-case-map-interactive'), false);
		assert.match(container.textContent || '', /could not load/i);
	});

	test('initMapLayersDemo falls back without Defra and constructs a map when available', () => {
		const dom = installDom(
			`<!DOCTYPE html><html><body>
				<div id="demo-1" data-map-layers-demo></div>
				<script id="demo-1-data" type="application/json">{"center":[0,0],"zoom":8,"projectGeojson":{"features":[{"type":"Feature"}]}}</script>
			</body></html>`
		);
		initMapLayersDemo('missing');
		initMapLayersDemo('demo-1');
		assert.match(dom.window.document.getElementById('demo-1')?.textContent || '', /could not load/i);

		installDom(
			`<!DOCTYPE html><html><body>
				<div id="demo-2" data-map-layers-demo></div>
				<script id="demo-2-data" type="application/json">{"center":[0,0],"zoom":8,"height":400,"mapLabel":"Demo","projectGeojson":{"features":[{"type":"Feature"}]},"railwayGeojson":{"features":[{"type":"Feature"}]},"roadGeojson":{"features":[{"type":"Feature"}]},"constraintGeojson":{"features":[{"type":"Feature"}]}}</script>
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
		initMapLayersDemo('demo-2');
		assert.equal(InteractiveMap.mock.callCount(), 1);

		installDom(
			`<!DOCTYPE html><html><body>
				<div id="demo-3" data-map-layers-demo></div>
				<script id="demo-3-data" type="application/json">{"center":[0,0],"zoom":8,"projectGeojson":{"features":[{"type":"Feature"}]}}</script>
			</body></html>`
		);
		globalThis.window.defra = {
			InteractiveMap: class {
				constructor() {
					throw new Error('boom');
				}
			},
			maplibreProvider: () => ({}),
			datasetsPlugin: () => ({}),
			mapKeyPlugin: () => ({})
		};
		initMapLayersDemo('demo-3');
		assert.match(document.getElementById('demo-3')?.textContent || '', /could not load/i);
	});

	test('registerMapLayersDemo handles readyState and missing document', () => {
		const dom = installDom(
			'<!DOCTYPE html><html><body><div id="demo-4" data-map-layers-demo></div><script id="demo-4-data" type="application/json">{"center":[0,0],"zoom":8}</script></body></html>'
		);
		Object.defineProperty(dom.window.document, 'readyState', { configurable: true, get: () => 'complete' });
		registerMapLayersDemo(dom.window.document);
		initAllMapLayersDemos();

		const loadingDom = installDom('<!DOCTYPE html><html><body></body></html>');
		Object.defineProperty(loadingDom.window.document, 'readyState', {
			configurable: true,
			get: () => 'loading'
		});
		const addEventListener = mock.fn();
		loadingDom.window.document.addEventListener = addEventListener;
		registerMapLayersDemo(loadingDom.window.document);
		assert.equal(addEventListener.mock.callCount(), 1);
		registerMapLayersDemo(undefined);
	});
});
