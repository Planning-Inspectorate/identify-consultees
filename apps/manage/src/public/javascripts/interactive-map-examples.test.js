import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import {
	buildPlugins,
	initAllInteractiveMapExamples,
	initInteractiveMapExample,
	readMapConfig,
	registerInteractiveMapExamples,
	showStaticMapFallback
} from './interactive-map-examples.js';

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

function pageHtml(config, mapId = 'demo-map') {
	const json = JSON.stringify({
		fallback: { src: '/static-map', alt: 'Static map', width: 960, height: 516 },
		...config
	});
	return `<!DOCTYPE html><html><body>
		<div id="${mapId}" class="app-interactive-map-example"></div>
		<script id="${mapId}-data" type="application/json">${json}</script>
	</body></html>`;
}

/** Mock InteractiveMap that records events so tests can fire them. */
function mockDefra(overrides = {}) {
	const handlers = new Map();
	const interactInstance = { enable: mock.fn(), clear: mock.fn() };
	const InteractiveMap = mock.fn(function InteractiveMap() {
		this.on = mock.fn((event, handler) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		});
		this.addMarker = mock.fn();
		this.updateMarker = mock.fn();
		this.addButton = mock.fn();
		this.addPanel = mock.fn((panelId, panelConfig) => {
			const match = /id="([^"]+)"/.exec(panelConfig?.html ?? '');
			if (match && globalThis.document && !globalThis.document.getElementById(match[1])) {
				const div = globalThis.document.createElement('div');
				div.id = match[1];
				globalThis.document.body.appendChild(div);
			}
		});
		this.showPanel = mock.fn();
		this.hidePanel = mock.fn();
	});
	return {
		defra: {
			InteractiveMap,
			maplibreProvider: mock.fn(() => ({})),
			datasetsPlugin: mock.fn(() => ({ datasetsInstance: true })),
			interactPlugin: mock.fn(() => interactInstance),
			drawPlugin: mock.fn(() => ({})),
			mapKeyPlugin: mock.fn(() => ({})),
			mapStylesPlugin: mock.fn(() => ({})),
			...overrides
		},
		interactInstance,
		fire(event, payload) {
			for (const handler of handlers.get(event) ?? []) {
				handler(payload);
			}
		},
		InteractiveMap
	};
}

describe('interactive-map-examples client helpers', () => {
	test('readMapConfig parses the embedded JSON block', () => {
		installDom(pageHtml({ kind: 'basic', zoom: 11 }));
		assert.equal(readMapConfig('demo-map')?.zoom, 11);

		installDom('<!DOCTYPE html><html><body><div id="x-data"></div></body></html>');
		assert.equal(readMapConfig('x'), null);

		installDom('<!DOCTYPE html><html><body><script id="bad-data" type="application/json">{nope</script></body></html>');
		assert.equal(readMapConfig('bad'), null);

		installDom('<!DOCTYPE html><html><body><script id="empty-data" type="application/json"></script></body></html>');
		assert.equal(readMapConfig('empty'), null);
	});

	test('buildPlugins instantiates only the configured plugins', () => {
		const { defra } = mockDefra();
		const { plugins, interact } = buildPlugins(defra, {
			datasets: [{ id: 'a' }],
			interact: { deselectOnClickOutside: true },
			mapKey: true
		});

		assert.equal(plugins.length, 3);
		assert.equal(defra.datasetsPlugin.mock.callCount(), 1);
		assert.equal(defra.interactPlugin.mock.callCount(), 1);
		assert.equal(defra.mapKeyPlugin.mock.callCount(), 1);
		assert.equal(defra.drawPlugin.mock.callCount(), 0);
		assert.ok(interact);
	});

	test('draw-tools instantiates the draw plugin and adds the polygon button at map:ready', () => {
		installDom(pageHtml({ kind: 'draw-tools', interact: {}, draw: { snapLayers: ['field-parcels'] } }));
		const drawInstance = { newPolygon: mock.fn() };
		const { defra, InteractiveMap, fire } = mockDefra({ drawPlugin: mock.fn(() => drawInstance) });
		globalThis.defra = defra;
		globalThis.window.defra = defra;

		initInteractiveMapExample('demo-map');
		assert.equal(defra.drawPlugin.mock.callCount(), 1);
		assert.deepEqual(defra.drawPlugin.mock.calls[0].arguments[0], { snapLayers: ['field-parcels'] });

		const map = InteractiveMap.mock.calls[0].this;
		fire('map:ready');
		const [buttonId, buttonConfig] = map.addButton.mock.calls[0].arguments;
		assert.equal(buttonId, 'drawPolygon');
		assert.equal(buttonConfig.label, 'Draw polygon');

		// clicking wires through to the plugin api (attached late by the core)
		buttonConfig.onClick();
		assert.equal(drawInstance.newPolygon.mock.callCount(), 1);
		assert.equal(typeof drawInstance.newPolygon.mock.calls[0].arguments[0], 'string');
	});

	test('a draw plugin without the late-bound api is a harmless no-op', () => {
		installDom(pageHtml({ kind: 'draw-tools', interact: {}, draw: {} }));
		const { defra, InteractiveMap, fire } = mockDefra();
		globalThis.defra = defra;
		globalThis.window.defra = defra;

		initInteractiveMapExample('demo-map');
		const map = InteractiveMap.mock.calls[0].this;
		fire('map:ready');
		// button still registers; onClick tolerates a plugin with no api attached
		const [, buttonConfig] = map.addButton.mock.calls[0].arguments;
		assert.doesNotThrow(() => buttonConfig.onClick());
	});

	test('initInteractiveMapExample tolerates a missing container and a bad config block', () => {
		installDom(pageHtml({ kind: 'basic' }));
		initInteractiveMapExample('no-such-map');

		// unparseable config means the fallback details are unknown too → text message
		installDom(
			'<!DOCTYPE html><html><body><div id="broken" class="app-interactive-map-example"></div><script id="broken-data" type="application/json">{bad</script></body></html>'
		);
		initInteractiveMapExample('broken');
		assert.match(document.getElementById('broken').textContent, /could not load/);
	});

	test('initInteractiveMapExample injects the static fallback when defra is missing', () => {
		const dom = installDom(pageHtml({ kind: 'basic', center: [0, 0], zoom: 8 }));
		initInteractiveMapExample('demo-map');

		const img = dom.window.document.querySelector('#demo-map img.app-case-map-static');
		assert.ok(img);
		assert.equal(img.getAttribute('src'), '/static-map');
		assert.equal(img.getAttribute('alt'), 'Static map');
		assert.equal(img.getAttribute('width'), '960');
	});

	test('initInteractiveMapExample constructs the map with config and plugins', () => {
		installDom(
			pageHtml({
				kind: 'polygons',
				center: [-2.46, 54.55],
				zoom: 14,
				height: 500,
				mapLabel: 'Demo',
				datasets: [{ id: 'x' }],
				mapKey: true,
				mapStyle: { url: 'u', attribution: 'a' }
			})
		);
		const { defra, InteractiveMap } = mockDefra();
		globalThis.defra = defra;
		globalThis.window.defra = defra;

		initInteractiveMapExample('demo-map');

		assert.equal(InteractiveMap.mock.callCount(), 1);
		const options = InteractiveMap.mock.calls[0].arguments[1];
		assert.equal(options.behaviour, 'inline');
		assert.equal(options.mapStyle.url, 'u');
		assert.equal(options.containerHeight, '500px');
		assert.equal(options.plugins.length, 2);
	});

	test('style-switcher uses the first configured style', () => {
		installDom(pageHtml({ kind: 'style-switcher', mapStyles: [{ id: 's1' }, { id: 's2' }] }));
		const { defra, InteractiveMap } = mockDefra();
		globalThis.defra = defra;
		globalThis.window.defra = defra;

		initInteractiveMapExample('demo-map');
		const options = InteractiveMap.mock.calls[0].arguments[1];
		assert.equal(options.mapStyle.id, 's1');
		assert.equal(defra.mapStylesPlugin.mock.callCount(), 1);
	});

	test('place-marker wires backAndContinue with a marker-gated continue button', () => {
		installDom(
			pageHtml({
				kind: 'place-marker',
				interact: { interactionModes: ['placeMarker'] },
				backAndContinue: { backLabel: 'Back', continueLabel: 'Continue', requireMarkerId: 'location' }
			})
		);
		const { defra, InteractiveMap } = mockDefra();
		globalThis.defra = defra;
		globalThis.window.defra = defra;

		initInteractiveMapExample('demo-map');
		const options = InteractiveMap.mock.calls[0].arguments[1];
		assert.equal(options.backAndContinue.continueLabel, 'Continue');
		assert.equal(
			options.backAndContinue.continueEnabledWhen({
				mapState: { markers: { items: [{ id: 'location' }] } }
			}),
			true
		);
		assert.equal(options.backAndContinue.continueEnabledWhen({ mapState: { markers: { items: [] } } }), false);
	});

	test('marker-label toggles the label on selection', () => {
		installDom(
			pageHtml({
				kind: 'marker-label',
				interact: { deselectOnClickOutside: true },
				marker: { id: 'm1', coords: [-2.96, 54.43], label: 'Demo location', showLabel: false }
			})
		);
		const { defra, InteractiveMap, fire } = mockDefra();
		globalThis.defra = defra;
		globalThis.window.defra = defra;

		initInteractiveMapExample('demo-map');
		const map = InteractiveMap.mock.calls[0].this;

		fire('map:ready');
		assert.equal(map.addMarker.mock.callCount(), 1);

		fire('interact:selectionchange', { selectedMarkers: ['m1'] });
		assert.deepEqual(map.updateMarker.mock.calls[0].arguments[1], { showLabel: true });

		fire('interact:selectionchange', { selectedMarkers: [] });
		assert.deepEqual(map.updateMarker.mock.calls[1].arguments[1], { showLabel: false });
	});

	test('marker-panel shows the details panel when the marker is selected', () => {
		installDom(
			pageHtml({
				kind: 'marker-panel',
				interact: { deselectOnClickOutside: true },
				marker: { id: 'm1', coords: [-2.96, 54.43] },
				panel: { id: 'marker-info', label: 'Marker details', property: 'name', fallback: 'Demo marker <near>' }
			})
		);
		const { defra, InteractiveMap, fire } = mockDefra();
		globalThis.defra = defra;
		globalThis.window.defra = defra;

		initInteractiveMapExample('demo-map');
		const map = InteractiveMap.mock.calls[0].this;

		fire('map:ready');
		assert.equal(map.addPanel.mock.callCount(), 1);

		fire('interact:selectionchange', { selectedMarkers: ['m1'] });
		assert.equal(map.showPanel.mock.callCount(), 1);
		// panel copy is HTML-escaped
		assert.match(document.getElementById('marker-info-content').innerHTML, /&lt;near&gt;/);

		fire('interact:selectionchange', { selectedMarkers: [] });
		assert.equal(map.hidePanel.mock.callCount(), 1);
	});

	test('marker-panel selection before the panel exists hides rather than errors', () => {
		installDom(
			pageHtml({
				kind: 'marker-panel',
				interact: {},
				marker: { id: 'm1', coords: [0, 0] },
				panel: { id: 'marker-info', label: 'x', property: 'name', fallback: 'fb' }
			})
		);
		const { defra, fire } = mockDefra();
		globalThis.defra = defra;
		globalThis.window.defra = defra;

		initInteractiveMapExample('demo-map');
		// no map:ready fired, so the panel content element does not exist yet
		const map = defra.InteractiveMap.mock.calls[0].this;
		fire('interact:selectionchange', { selectedMarkers: ['m1'] });
		assert.equal(map.hidePanel.mock.callCount(), 1);
	});

	test('panelclose events for other panels are ignored', () => {
		installDom(
			pageHtml({
				kind: 'select-feature',
				interact: {},
				panel: { id: 'parcel-info', label: 'x', property: 'name', fallback: 'fb' }
			})
		);
		const { defra, interactInstance, InteractiveMap, fire } = mockDefra();
		globalThis.defra = defra;
		globalThis.window.defra = defra;

		initInteractiveMapExample('demo-map');
		const map = InteractiveMap.mock.calls[0].this;
		fire('app:panelclosed', { panelId: 'other-panel' });
		assert.equal(interactInstance.clear.mock.callCount(), 0);

		// selected feature with missing properties falls back to the panel fallback text
		fire('map:ready');
		fire('interact:selectionchange', { selectedFeatures: [{ properties: undefined }] });
		assert.match(document.getElementById('parcel-info-content').innerHTML, />fb</);
		assert.equal(map.showPanel.mock.callCount(), 1);
	});

	test('missing plugin factories are skipped and a half-loaded defra falls back', () => {
		installDom(
			pageHtml({
				kind: 'draw-tools',
				datasets: [{ id: 'x' }],
				interact: {},
				draw: {},
				mapStyles: [{ id: 's' }],
				mapKey: true,
				mapStyle: { url: 'u', attribution: 'a' }
			})
		);
		// defra has the constructor but no plugin factories
		const defra = {
			InteractiveMap: mock.fn(function InteractiveMap() {
				this.on = mock.fn();
			}),
			maplibreProvider: () => ({})
		};
		globalThis.defra = defra;
		globalThis.window.defra = defra;

		initInteractiveMapExample('demo-map');
		const options = defra.InteractiveMap.mock.calls[0].arguments[1];
		assert.equal(options.plugins.length, 0);
		// mapStyles wins over mapStyle when both are present (style-switcher convention)
		assert.equal(options.mapStyle.id, 's');

		// defra present but missing the constructor → static fallback
		installDom(pageHtml({ kind: 'basic' }));
		globalThis.window.defra = { maplibreProvider: () => ({}) };
		globalThis.defra = globalThis.window.defra;
		initInteractiveMapExample('demo-map');
		assert.ok(document.querySelector('#demo-map img.app-case-map-static'));

		// defra with a constructor but no provider → static fallback
		installDom(pageHtml({ kind: 'basic' }));
		globalThis.window.defra = { InteractiveMap: mock.fn(function InteractiveMap() {}) };
		globalThis.defra = globalThis.window.defra;
		initInteractiveMapExample('demo-map');
		assert.ok(document.querySelector('#demo-map img.app-case-map-static'));
	});

	test('a panel without an interact plugin and a selection before the panel exists are safe', () => {
		installDom(
			pageHtml({
				kind: 'select-feature',
				behaviour: 'hybrid',
				interact: { interactionModes: ['selectFeature'] },
				panel: { id: 'parcel-info', label: 'x', property: 'name', fallback: 'fb' }
			})
		);
		const { defra, InteractiveMap, fire } = mockDefra();
		// interact plugin returns a plain object with no enable/clear helpers
		defra.interactPlugin = mock.fn(() => ({}));
		globalThis.defra = defra;
		globalThis.window.defra = defra;

		initInteractiveMapExample('demo-map');
		const map = InteractiveMap.mock.calls[0].this;
		// selection before map:ready → the panel element is not in the DOM yet
		fire('interact:selectionchange', { selectedFeatures: [{ properties: { name: 'x' } }] });
		assert.equal(map.hidePanel.mock.callCount(), 1);

		// map:ready fires the enable hook — a plugin object without the late-bound
		// api is a harmless no-op; the configured panel is still registered
		fire('map:ready');
		assert.equal(map.addPanel.mock.callCount(), 1);

		// panelclose for this panel can't clear a plugin with no clear helper
		fire('app:panelclosed', { panelId: 'parcel-info' });
	});

	test('initAllInteractiveMapExamples skips containers without an id and non-HTML elements', () => {
		installDom(
			'<!DOCTYPE html><html><body><div class="app-interactive-map-example"></div><div id="m2" class="app-interactive-map-example"></div><script id="m2-data" type="application/json">{"kind":"basic","fallback":{"src":"/s","alt":"a"}}</script></body></html>'
		);
		// a namespaced SVG element carrying the marker class must be ignored
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.classList.add('app-interactive-map-example');
		document.body.appendChild(svg);

		initAllInteractiveMapExamples();
		assert.ok(document.querySelector('#m2 img.app-case-map-static'));
	});

	test('select-feature shows the selected property in the panel and clears on close', () => {
		installDom(
			pageHtml({
				kind: 'select-feature',
				interact: { interactionModes: ['selectFeature'], layers: [{ layerId: 'x', idProperty: 'name' }] },
				panel: { id: 'parcel-info', label: 'Selected parcel', property: 'name', fallback: 'Selected' }
			})
		);
		const { defra, interactInstance, InteractiveMap, fire } = mockDefra();
		globalThis.defra = defra;
		globalThis.window.defra = defra;

		initInteractiveMapExample('demo-map');
		const map = InteractiveMap.mock.calls[0].this;

		fire('map:ready');
		// the interact plugin is enabled once the map is ready
		assert.equal(interactInstance.enable.mock.callCount(), 1);

		fire('interact:selectionchange', { selectedFeatures: [{ properties: { name: 'Large meadow' } }] });
		assert.equal(map.showPanel.mock.callCount(), 1);
		assert.match(document.getElementById('parcel-info-content').innerHTML, /Large meadow/);

		fire('interact:selectionchange', { selectedFeatures: [] });
		assert.equal(map.hidePanel.mock.callCount(), 1);

		fire('app:panelclosed', { panelId: 'parcel-info' });
		assert.equal(interactInstance.clear.mock.callCount(), 1);
	});

	test('select-feature renders the detail line only when the feature has the detail property', () => {
		installDom(
			pageHtml({
				kind: 'select-feature',
				interact: { interactionModes: ['selectFeature'] },
				panel: {
					id: 'parcel-info',
					label: 'Selected parcel',
					property: 'name',
					detailProperty: 'landUse',
					detailLabel: 'Land use',
					fallback: 'Selected'
				}
			})
		);
		const { defra, InteractiveMap, fire } = mockDefra();
		globalThis.defra = defra;
		globalThis.window.defra = defra;

		initInteractiveMapExample('demo-map');
		fire('map:ready');

		fire('interact:selectionchange', {
			selectedFeatures: [{ properties: { name: 'Large meadow', landUse: 'Permanent grassland' } }]
		});
		const html = document.getElementById('parcel-info-content').innerHTML;
		assert.match(html, /Large meadow/);
		assert.match(html, /Land use: Permanent grassland/);

		// a feature without the detail property renders the name line only
		fire('interact:selectionchange', { selectedFeatures: [{ properties: { name: 'Lamb field' } }] });
		const htmlNoDetail = document.getElementById('parcel-info-content').innerHTML;
		assert.match(htmlNoDetail, /Lamb field/);
		assert.doesNotMatch(htmlNoDetail, /Land use/);
	});

	test('select-feature falls back to the property name when no detail label is configured', () => {
		installDom(
			pageHtml({
				kind: 'select-feature',
				interact: { interactionModes: ['selectFeature'] },
				panel: { id: 'parcel-info', label: 'Selected parcel', property: 'name', detailProperty: 'landUse' }
			})
		);
		const { defra, InteractiveMap, fire } = mockDefra();
		globalThis.defra = defra;
		globalThis.window.defra = defra;

		initInteractiveMapExample('demo-map');
		fire('map:ready');
		fire('interact:selectionchange', { selectedFeatures: [{ properties: { name: 'x', landUse: 'Woodland' } }] });
		assert.match(document.getElementById('parcel-info-content').innerHTML, /landUse: Woodland/);
	});

	test('init falls back to the static map when the constructor throws', () => {
		installDom(pageHtml({ kind: 'basic' }));
		const Throwing = mockDefra();
		Throwing.defra.InteractiveMap = function InteractiveMap() {
			throw new Error('boom');
		};
		globalThis.defra = Throwing.defra;
		globalThis.window.defra = Throwing.defra;

		initInteractiveMapExample('demo-map');
		assert.ok(document.querySelector('#demo-map img.app-case-map-static'));
	});

	test('showStaticMapFallback is idempotent and works without a src', () => {
		const dom = installDom(
			'<!DOCTYPE html><html><body><div id="a" class="app-interactive-map-example"><img class="app-case-map-static"></div><div id="b"></div><div id="c"></div></body></html>'
		);
		const withImg = dom.window.document.getElementById('a');
		showStaticMapFallback(withImg, { src: '/s' });
		assert.equal(withImg.querySelectorAll('img').length, 1);

		const noSrc = dom.window.document.getElementById('b');
		showStaticMapFallback(noSrc);
		assert.match(noSrc.textContent, /could not load/);

		// the hidden feature list is revealed whenever the fallback shows
		const dom2 = installDom(
			'<!DOCTYPE html><html><body><div id="d" class="app-interactive-map-example"></div><div id="d-fallback" hidden><p>listed</p></div></body></html>'
		);
		showStaticMapFallback(dom2.window.document.getElementById('d'), { src: '/s' });
		assert.equal(dom2.window.document.getElementById('d-fallback').hidden, false);

		// a src with no alt/width/height falls back to safe defaults
		const bare = dom.window.document.getElementById('c');
		showStaticMapFallback(bare, { src: '/s' });
		const img = bare.querySelector('img.app-case-map-static');
		assert.equal(img.getAttribute('src'), '/s');
		assert.equal(img.getAttribute('alt'), '');
		assert.equal(img.getAttribute('width'), '960');
	});

	test('initAllInteractiveMapExamples covers every container; register handles readyState', () => {
		const dom = installDom(
			pageHtml({ kind: 'basic' }, 'm1') + '' // single container
		);
		Object.defineProperty(dom.window.document, 'readyState', { configurable: true, get: () => 'complete' });
		registerInteractiveMapExamples(dom.window.document);
		initAllInteractiveMapExamples();
		assert.ok(dom.window.document.querySelector('#m1 img'));

		const loading = installDom('<!DOCTYPE html><html><body></body></html>');
		Object.defineProperty(loading.window.document, 'readyState', { configurable: true, get: () => 'loading' });
		const addEventListener = mock.fn();
		loading.window.document.addEventListener = addEventListener;
		registerInteractiveMapExamples(loading.window.document);
		assert.equal(addEventListener.mock.callCount(), 1);
		registerInteractiveMapExamples(undefined);
	});
});
