import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import {
	LayersKeyPanel,
	buildLayersMenu,
	buildSwatch,
	createLayersKeyPlugin,
	mergedDatasetStyle,
	styleValue
} from './layers-key-plugin.mjs';

let compat;
let dom;

async function installDom(html = '<!DOCTYPE html><html><body></body></html>') {
	dom = new JSDOM(html);
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

function fakeEventBus() {
	const handlers = {};
	const onceHandlers = {};
	return {
		handlers,
		onceHandlers,
		on: mock.fn((event, handler) => {
			handlers[event] = handler;
		}),
		off: mock.fn(),
		once: mock.fn((event, handler) => {
			onceHandlers[event] = handler;
		}),
		requestOnce: mock.fn()
	};
}

function fakeServices({ eventBus = fakeEventBus(), setDatasetVisibility } = {}) {
	return {
		eventBus,
		getPlugin: mock.fn((id) => (id === 'datasets' && setDatasetVisibility ? { setDatasetVisibility } : undefined))
	};
}

const shapefileDataset = (id, overrides = {}) => ({
	id,
	label: `${id}.geojson`,
	groupLabel: 'GIS shapefiles',
	showInMenu: true,
	showInKey: true,
	style: { stroke: '#C44E52', strokeWidth: 2, fill: 'rgba(196, 78, 82, 0.45)' },
	...overrides
});

describe('layers-key-plugin helpers', () => {
	test('styleValue resolves strings and map-style-keyed objects', () => {
		assert.equal(styleValue('#fff', 'outdoor'), '#fff');
		assert.equal(styleValue({ outdoor: '#aaa', dark: '#bbb' }, 'dark'), '#bbb');
		assert.equal(styleValue({ outdoor: '#aaa', dark: '#bbb' }, 'unknown'), '#aaa');
		assert.equal(styleValue(undefined, 'outdoor'), null);
		assert.equal(styleValue('   ', 'outdoor'), null);
		assert.equal(styleValue({}, 'outdoor'), null);
	});

	test('mergedDatasetStyle layers defaults, dataset style then sublayer overrides', () => {
		const dataset = { style: { stroke: '#111', strokeWidth: 3, symbolBackgroundColor: '#999' } };
		const sublayer = { style: { symbolBackgroundColor: '#f47738' } };
		assert.deepEqual(mergedDatasetStyle(dataset, sublayer), {
			stroke: '#111',
			strokeWidth: 3,
			symbolBackgroundColor: '#f47738'
		});
		// a styleless dataset still draws the plugin's default red outline
		assert.deepEqual(mergedDatasetStyle({}), { stroke: '#d4351c', strokeWidth: 2 });
		assert.deepEqual(mergedDatasetStyle(), { stroke: '#d4351c', strokeWidth: 2 });
	});

	test('buildLayersMenu groups plain datasets under a shared groupLabel', () => {
		const menu = buildLayersMenu([shapefileDataset('a'), shapefileDataset('b', { visible: false })]);
		assert.equal(menu.length, 1);
		assert.equal(menu[0].groupLabel, 'GIS shapefiles');
		assert.deepEqual(
			menu[0].items.map((item) => [item.id, item.visible]),
			[
				['a', true],
				['b', false]
			]
		);
		assert.equal(menu[0].items[0].datasetId, 'a');
		assert.equal(menu[0].items[0].sublayerId, undefined);
		assert.equal(menu[0].items[0].style.stroke, '#C44E52');
	});

	test('buildLayersMenu emits a single unlabelled row for plain datasets', () => {
		assert.deepEqual(buildLayersMenu(), []);
		assert.deepEqual(buildLayersMenu([]), []);

		const menu = buildLayersMenu([{ id: 'site', label: 'Site', showInMenu: true, style: { fill: '#000' } }]);
		assert.equal(menu.length, 1);
		assert.equal(menu[0].groupLabel, undefined);
		assert.deepEqual(
			menu[0].items.map((item) => item.id),
			['site']
		);
	});

	test('buildLayersMenu keeps menu-visible sublayers of a hidden dataset', () => {
		const menu = buildLayersMenu([
			{
				id: 'parent',
				label: 'Parent',
				showInMenu: false,
				sublayers: [
					{ id: 'kept', showInMenu: true },
					{ id: 'dropped', label: 'Dropped' }
				]
			}
		]);
		assert.equal(menu.length, 1);
		assert.equal(menu[0].groupLabel, 'Parent');
		assert.deepEqual(
			menu[0].items.map((item) => item.id),
			['parent-kept']
		);
		// a label-less sublayer inherits the dataset's label
		assert.equal(menu[0].items[0].label, 'Parent');
	});

	test('buildLayersMenu lists sublayers under their dataset label with composite ids', () => {
		const menu = buildLayersMenu([
			{
				id: 'consultee-areas',
				label: 'Consultee areas',
				showInMenu: true,
				style: { stroke: '#000' },
				sublayers: [
					{ id: 's1', label: 'Hospitals', style: { symbolBackgroundColor: '#f47738' } },
					{ id: 's2', label: 'Police', showInMenu: false }
				]
			}
		]);
		assert.equal(menu.length, 1);
		assert.equal(menu[0].groupLabel, 'Consultee areas');
		assert.deepEqual(
			menu[0].items.map((item) => item.id),
			['consultee-areas-s1']
		);
		assert.equal(menu[0].items[0].datasetId, 'consultee-areas');
		assert.equal(menu[0].items[0].sublayerId, 's1');
		// the row style merges parent + sublayer
		assert.equal(menu[0].items[0].style.stroke, '#000');
		assert.equal(menu[0].items[0].style.symbolBackgroundColor, '#f47738');
	});

	test('buildLayersMenu skips hidden menu entries and falls back to the dataset row', () => {
		const menu = buildLayersMenu([
			shapefileDataset('hidden', { showInMenu: false }),
			{
				id: 'all-opted-out',
				label: 'Grouped',
				showInMenu: true,
				sublayers: [{ id: 's', label: 'sub', showInMenu: false }]
			}
		]);
		assert.equal(menu.length, 1);
		assert.equal(menu[0].groupLabel, undefined);
		assert.deepEqual(
			menu[0].items.map((item) => item.id),
			['all-opted-out']
		);
	});

	test('buildSwatch draws fills as shapes and bare strokes as lines', () => {
		const fill = buildSwatch({ stroke: '#C44E52', strokeWidth: 2, fill: 'rgba(1,2,3,0.4)' });
		assert.deepEqual(fill, { shape: 'rect', fill: 'rgba(1,2,3,0.4)', stroke: '#C44E52', strokeWidth: 2 });

		const outline = buildSwatch({ stroke: '#C44E52', strokeWidth: 2, fill: 'transparent' });
		assert.equal(outline.shape, 'rect');
		assert.equal(outline.fill, 'transparent');

		const line = buildSwatch({ stroke: '#1d70b8', strokeWidth: 3, strokeDashArray: [2, 2] });
		assert.deepEqual(line, { shape: 'line', stroke: '#1d70b8', strokeWidth: 3 });
	});

	test('buildSwatch resolves symbol datasets through the symbol registry when available', () => {
		const symbolRegistry = {
			getSymbolDef: (style) => ({ svg: style.symbolSvgContent }),
			resolve: (def, tokens) => `${def.svg}|${tokens.backgroundColor}`
		};
		const style = {
			symbol: 'circle',
			symbolSvgContent: '<circle fill="{{backgroundColor}}"/>',
			symbolViewBox: '0 0 16 16',
			symbolBackgroundColor: '#f47738'
		};
		assert.deepEqual(buildSwatch(style, { symbolRegistry }), {
			shape: 'symbol',
			svgContent: '<circle fill="{{backgroundColor}}"/>|#f47738',
			viewBox: '0 0 16 16'
		});
		// without the registry it degrades to a dot in the symbol colour
		assert.deepEqual(buildSwatch(style), { shape: 'circle', fill: '#f47738' });
	});

	test('buildSwatch resolves fill patterns through the pattern registry when available', () => {
		const patternRegistry = { getKeyPatternPaths: () => ({ border: '<path/>', content: '<path/>' }) };
		assert.deepEqual(buildSwatch({ fillPattern: 'dot' }, { patternRegistry }), {
			shape: 'pattern',
			border: '<path/>',
			content: '<path/>'
		});
	});

	test('buildSwatch falls back to a rect when the pattern registry cannot resolve', () => {
		// no registry at all - pattern colours fall back to the dataset stroke
		assert.deepEqual(buildSwatch({ fillPattern: 'dot', stroke: '#123456', strokeWidth: 2 }), {
			shape: 'rect',
			fill: 'transparent',
			stroke: '#123456',
			strokeWidth: 2
		});
		// registry present but returns nothing - its own colours win when set
		const patternRegistry = { getKeyPatternPaths: () => null };
		assert.deepEqual(
			buildSwatch(
				{
					fillPatternSvgContent: '<path/>',
					fillPatternBackgroundColor: '#eee',
					fillPatternForegroundColor: '#333',
					strokeWidth: 3
				},
				{ patternRegistry }
			),
			{ shape: 'rect', fill: '#eee', stroke: '#333', strokeWidth: 3 }
		);
	});

	test('buildSwatch honours keySymbolShape and the nothing-drawable fallback', () => {
		// keySymbolShape forces a line even when a fill is set
		assert.deepEqual(buildSwatch({ fill: '#123', stroke: '#456', strokeWidth: 2, keySymbolShape: 'line' }), {
			shape: 'line',
			stroke: '#456',
			strokeWidth: 2
		});
		// no fill and no stroke - the default red outline
		assert.deepEqual(buildSwatch({}), { shape: 'rect', fill: 'transparent', stroke: '#d4351c', strokeWidth: 2 });
		// a fill alone still draws a shape
		assert.equal(buildSwatch({ fill: '#123' }).shape, 'rect');
	});

	test('buildSwatch degrades symbol styles without a resolvable symbol def', () => {
		// symbolSvgContent alone marks the style as a symbol
		const viewBoxRegistry = {
			getSymbolDef: () => ({ viewBox: '0 0 24 24' }),
			resolve: () => '<path/>'
		};
		assert.deepEqual(buildSwatch({ symbolSvgContent: '<x/>' }, { symbolRegistry: viewBoxRegistry }), {
			shape: 'symbol',
			svgContent: '<path/>',
			viewBox: '0 0 24 24'
		});
		// neither the style nor the def supplies a viewBox - the default applies
		const noViewBoxRegistry = { getSymbolDef: () => ({}), resolve: () => '<path/>' };
		assert.equal(buildSwatch({ symbolSvgContent: '<x/>' }, { symbolRegistry: noViewBoxRegistry }).viewBox, '0 0 38 38');
		// an unresolvable def, or a resolve returning nothing, shows the dot
		const missingDef = { getSymbolDef: () => undefined };
		assert.equal(buildSwatch({ symbol: 'x' }, { symbolRegistry: missingDef }).shape, 'circle');
		const nullResolve = { getSymbolDef: () => ({}), resolve: () => null };
		assert.equal(buildSwatch({ symbolSvgContent: '<x/>' }, { symbolRegistry: nullResolve }).shape, 'circle');
		// the dot defaults to the key colour when no symbolBackgroundColor is set
		assert.equal(buildSwatch({ symbol: 'x' }).fill, '#1d70b8');
	});
});

describe('layers-key-plugin descriptor', () => {
	test('createLayersKeyPlugin returns a descriptor whose load yields the manifest', async () => {
		const plugin = createLayersKeyPlugin({ datasets: [{ id: 'a' }] });
		assert.equal(plugin.id, 'layersKey');
		assert.equal(plugin.datasets[0].id, 'a');
		assert.ok(plugin.checkedCache instanceof Map);

		const loaded = await plugin.load();
		assert.equal(loaded.buttons[0].panelId, 'layersKey');
		assert.equal(loaded.panels[0].id, 'layersKey');
		assert.equal(typeof loaded.panels[0].render, 'function');
		assert.equal(loaded.buttons[0].iconId, 'app-layers-key');
		assert.equal(loaded.icons[0].id, 'app-layers-key');
	});

	test('button and panel labels fall back to Layers and honour pluginConfig', async () => {
		const loaded = await createLayersKeyPlugin().load();
		const buttonLabel = loaded.buttons[0].label;
		const panelLabel = loaded.panels[0].label;
		assert.equal(buttonLabel({ pluginConfig: {} }), 'Layers');
		assert.equal(buttonLabel({ pluginConfig: { buttonLabel: 'Layers and key' } }), 'Layers and key');
		assert.equal(panelLabel({ pluginConfig: {} }), 'Layers');
		assert.equal(panelLabel({ pluginConfig: { panelLabel: 'Layers and key' } }), 'Layers and key');
	});
});

describe('LayersKeyPanel component', () => {
	const renderPanel = async (props) => {
		await installDom();
		const container = document.createElement('div');
		document.body.appendChild(container);
		compat.render(compat.createElement(LayersKeyPanel, props), container);
		await flushEffects();
		return container;
	};

	test('renders a checkbox row per menu item with a swatch and group heading', async () => {
		const container = await renderPanel({
			pluginConfig: {
				datasets: [shapefileDataset('a'), shapefileDataset('b', { visible: false })],
				checkedCache: new Map()
			},
			appConfig: { id: 'map-1' },
			mapState: {},
			services: fakeServices()
		});

		assert.match(container.querySelector('legend')?.textContent || '', /GIS shapefiles/);
		const inputs = container.querySelectorAll('input[type="checkbox"]');
		assert.equal(inputs.length, 2);
		assert.equal(inputs[0].checked, true);
		assert.equal(inputs[1].checked, false);
		assert.equal(container.querySelectorAll('.app-layers-key__swatch').length, 2);
		assert.match(container.textContent, /a\.geojson/);
	});

	test('toggling a row calls setDatasetVisibility on the datasets plugin', async () => {
		const setDatasetVisibility = mock.fn();
		const container = await renderPanel({
			pluginConfig: {
				datasets: [
					{
						id: 'consultee-areas',
						label: 'Consultee areas',
						showInMenu: true,
						sublayers: [{ id: 's1', label: 'Hospitals' }]
					}
				],
				checkedCache: new Map()
			},
			appConfig: { id: 'map-1' },
			mapState: {},
			services: fakeServices({ setDatasetVisibility })
		});

		const input = container.querySelector('input[type="checkbox"]');
		input.checked = false;
		input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

		assert.equal(setDatasetVisibility.mock.callCount(), 1);
		assert.deepEqual(setDatasetVisibility.mock.calls[0].arguments, [
			false,
			{ datasetId: 'consultee-areas', sublayerId: 's1' }
		]);
	});

	test('a checked cache survives panel remounts, matching the persisted toggle', async () => {
		const checkedCache = new Map();
		const services = fakeServices({ setDatasetVisibility: mock.fn() });
		const datasets = [shapefileDataset('a')];
		const props = {
			pluginConfig: { datasets, checkedCache },
			appConfig: { id: 'map-1' },
			mapState: {},
			services
		};

		let container = await renderPanel(props);
		const input = container.querySelector('input[type="checkbox"]');
		input.checked = false;
		input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
		await flushEffects();
		assert.equal(checkedCache.get('a'), false);

		// the component unmounts when the real panel closes - remount and the row stays unchecked
		compat.render(null, container);
		container.remove();
		container = await renderPanel(props);
		assert.equal(container.querySelector('input[type="checkbox"]').checked, false);
	});

	test('subscribes to the datasets registry and refreshes on datasets:changed', async () => {
		const eventBus = fakeEventBus();
		await renderPanel({
			pluginConfig: { datasets: [shapefileDataset('a')], checkedCache: new Map() },
			appConfig: { id: 'map-1' },
			mapState: {},
			services: fakeServices({ eventBus })
		});

		assert.ok(eventBus.requestOnce.mock.calls.some((call) => call.arguments[0] === 'datasets:registry'));
		assert.equal(
			eventBus.on.mock.calls.some((call) => call.arguments[0] === 'datasets:changed'),
			true
		);
	});

	test('shows the empty text when no dataset is menu-visible', async () => {
		const container = await renderPanel({
			pluginConfig: {
				datasets: [shapefileDataset('hidden', { showInMenu: false })],
				checkedCache: new Map(),
				emptyText: 'Nothing toggleable'
			},
			appConfig: { id: 'map-1' },
			mapState: {},
			services: fakeServices()
		});
		assert.match(container.textContent, /Nothing toggleable/);
	});

	test('defaults the empty text and tolerates a missing appConfig/datasets', async () => {
		// no datasets configured at all - the ?? fallbacks kick in
		const container = await renderPanel({
			pluginConfig: {},
			services: fakeServices()
		});
		assert.match(container.textContent, /No layers to show/);
	});

	test('renders without an event bus and toggles a dataset-level row', async () => {
		// services present but no eventBus - the effect returns early
		const setDatasetVisibility = mock.fn();
		const container = await renderPanel({
			pluginConfig: { datasets: [shapefileDataset('a')], checkedCache: new Map() },
			services: { getPlugin: () => ({ setDatasetVisibility }) }
		});

		const input = container.querySelector('input[type="checkbox"]');
		input.checked = false;
		input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
		assert.deepEqual(setDatasetVisibility.mock.calls[0].arguments, [false, { datasetId: 'a' }]);

		// no services at all - the panel still renders and toggling is a no-op
		const bare = await renderPanel({ pluginConfig: { datasets: [shapefileDataset('b')] } });
		const bareInput = bare.querySelector('input[type="checkbox"]');
		bareInput.checked = false;
		bareInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
		assert.equal(bareInput.checked, false);
	});

	test('reads checked state from the shared registry when it holds our datasets', async () => {
		const registry = {
			datasets: { a: {} },
			getDataset: mock.fn(() => ({ isLocallyVisible: false, visible: false }))
		};
		const eventBus = fakeEventBus();
		eventBus.requestOnce.mock.mockImplementation((event, cb) => {
			if (event === 'datasets:registry') cb(registry);
		});

		const container = await renderPanel({
			pluginConfig: { datasets: [shapefileDataset('a')], checkedCache: new Map() },
			appConfig: { id: 'map-1' },
			mapState: {},
			services: fakeServices({ eventBus })
		});

		// isLocallyVisible drives the checkbox; a not-visible layer dims the row
		const input = container.querySelector('input[type="checkbox"]');
		assert.equal(input.checked, false);
		const item = container.querySelector('.im-c-datasets-layers__item');
		assert.match(item.className, /im-c-datasets-layers__item--checked/);

		// a registry refresh re-reads the state
		registry.getDataset = mock.fn(() => ({ isLocallyVisible: true, visible: true }));
		eventBus.handlers['datasets:changed']();
		await flushEffects();
		assert.equal(container.querySelector('input[type="checkbox"]').checked, true);
		assert.doesNotMatch(container.querySelector('.im-c-datasets-layers__item').className, /item--checked/);
	});

	test("ignores a registry that holds another map's datasets", async () => {
		const registry = {
			datasets: { 'other-map-dataset': {} },
			getDataset: mock.fn(() => undefined)
		};
		const eventBus = fakeEventBus();
		eventBus.requestOnce.mock.mockImplementation((event, cb) => {
			if (event === 'datasets:registry') cb(registry);
		});
		// registry published again once the datasets plugin reports ready
		eventBus.onceHandlers['datasets:ready']?.();

		const container = await renderPanel({
			pluginConfig: { datasets: [shapefileDataset('a')] },
			appConfig: { id: 'map-1' },
			mapState: {},
			services: fakeServices({ eventBus })
		});
		// the dataset's own `visible` default applies, not the foreign registry
		assert.equal(container.querySelector('input[type="checkbox"]').checked, true);
	});

	test('falls back to the item defaults when the registry misses the row', async () => {
		// registry claims our dataset ids but getDataset comes back empty
		const registry = {
			datasets: { a: {} },
			getDataset: mock.fn(() => undefined)
		};
		const eventBus = fakeEventBus();
		eventBus.requestOnce.mock.mockImplementation((event, cb) => {
			if (event === 'datasets:registry') cb(registry);
		});

		const container = await renderPanel({
			pluginConfig: { datasets: [shapefileDataset('a')] },
			appConfig: { id: 'map-1' },
			mapState: {},
			services: fakeServices({ eventBus })
		});
		assert.equal(container.querySelector('input[type="checkbox"]').checked, true);
	});

	test('tolerates a datasets plugin without the visibility api', async () => {
		const container = await renderPanel({
			pluginConfig: { datasets: [shapefileDataset('a')], checkedCache: new Map() },
			appConfig: { id: 'map-1' },
			mapState: {},
			// getPlugin absent entirely, and present-but-methodless
			services: { eventBus: fakeEventBus() }
		});
		const input = container.querySelector('input[type="checkbox"]');
		input.checked = false;
		input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

		const container2 = await renderPanel({
			pluginConfig: { datasets: [shapefileDataset('b')], checkedCache: new Map() },
			appConfig: { id: 'map-1' },
			mapState: {},
			services: { eventBus: fakeEventBus(), getPlugin: () => ({}) }
		});
		const input2 = container2.querySelector('input[type="checkbox"]');
		input2.checked = false;
		input2.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
		assert.equal(input2.checked, false);
	});

	test('renders symbol, pattern, dot and line swatches from the service registries', async () => {
		const symbolRegistry = {
			getSymbolDef: (style) => (style.symbolSvgContent ? { svg: style.symbolSvgContent } : undefined),
			resolve: (def, tokens) => def.svg.replace('{{c}}', tokens.backgroundColor)
		};
		const patternRegistry = {
			getKeyPatternPaths: () => ({ border: '<rect width="20"/>', content: '<path d="M0 0"/>' })
		};
		const services = { ...fakeServices(), symbolRegistry, patternRegistry };
		const container = await renderPanel({
			pluginConfig: {
				datasets: [
					{
						id: 'sym',
						label: 'Symbol layer',
						showInMenu: true,
						style: {
							symbol: 'circle',
							symbolSvgContent: '<circle fill="{{c}}"/>',
							symbolBackgroundColor: '#f00',
							symbolDescription: 'Red circle'
						}
					},
					{ id: 'pat', label: 'Pattern layer', showInMenu: true, style: { fillPattern: 'dot' } },
					{ id: 'dot', label: 'Dot layer', showInMenu: true, style: { symbol: 'square' } },
					{
						id: 'line',
						label: 'Line layer',
						showInMenu: true,
						style: { stroke: { outdoor: '#1d70b8', dark: '#fff' }, strokeWidth: 3 }
					}
				],
				checkedCache: new Map()
			},
			appConfig: { id: 'map-1' },
			mapState: { mapStyle: { id: 'outdoor' } },
			services
		});

		const swatches = container.querySelectorAll('.app-layers-key__swatch');
		assert.equal(swatches.length, 4);
		// symbol resolved through the registry - its svg content is injected
		assert.match(swatches[0].innerHTML, /circle fill="#f00"/);
		// the accessible symbol description rides along visually-hidden
		assert.match(container.textContent, /\(Red circle\)/);
		// pattern swatch draws border + content groups
		assert.match(swatches[1].innerHTML, /<rect width="20"/);
		assert.match(swatches[1].innerHTML, /<path d="M0 0"/);
		// an unresolvable symbol degrades to the dot
		assert.ok(swatches[2].querySelector('circle'));
		// a stroke-only style draws a line in the map-style-keyed colour
		const line = swatches[3].querySelector('line');
		assert.ok(line);
		assert.equal(line.getAttribute('stroke'), '#1d70b8');
	});

	test('the manifest render entry goes through the preact guard shell', async () => {
		const loaded = await createLayersKeyPlugin({ datasets: [shapefileDataset('a')] }).load();
		// without the map bundle's preactCompat the panel renders nothing rather than crashing
		assert.equal(loaded.panels[0].render({ pluginConfig: {} }), null);

		await installDom();
		const container = document.createElement('div');
		document.body.appendChild(container);
		compat.render(
			loaded.panels[0].render({
				pluginConfig: { datasets: [shapefileDataset('a')], checkedCache: new Map() },
				appConfig: { id: 'map-1' },
				mapState: {},
				services: fakeServices()
			}),
			container
		);
		await flushEffects();
		assert.ok(container.querySelector('input[type="checkbox"]'));
	});
});
