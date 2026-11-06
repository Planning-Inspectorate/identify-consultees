import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import {
	applySelection,
	bindingForValue,
	controlInputs,
	createExternalControlsPlugin,
	featureForBinding,
	featureMatchesBinding,
	syncControlsFromSelection
} from './external-controls-plugin.mjs';

let dom;
let compat;

async function installDom(html = '<!DOCTYPE html><html><body></body></html>') {
	dom = new JSDOM(html);
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.HTMLElement = dom.window.HTMLElement;
	// jsdom has no raf unless pretendToBeVisual; preact defers useEffect through it
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

// preact defers useEffect through requestAnimationFrame (stubbed to setTimeout(0)
// in installDom) - wait for the stub to actually fire, not just a fixed delay
const flushEffects = () =>
	new Promise((resolve) => {
		requestAnimationFrame(() => setTimeout(resolve, 0));
	});

const bindingFor = (id) => ({
	value: id,
	featureId: id,
	idProperty: 'fileKey',
	datasetId: `shapefile-${id}`,
	layerId: `shapefile-${id}`
});

const datasetFor = (binding, extra = {}) => ({
	id: binding.datasetId,
	geojson: {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				properties: { fileKey: binding.featureId, name: `File ${binding.featureId}` },
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[0, 0],
							[1, 0],
							[1, 1],
							[0, 0]
						]
					]
				}
			}
		]
	},
	...extra
});

/** A fake `services` context: records emits, replays them to subscribers like the real bus. */
function fakeServices({ getPlugin } = {}) {
	const emitted = [];
	const handlers = new Map();
	const apis = {
		datasets: { setDatasetVisibility: mock.fn(), setOpacity: mock.fn() },
		interact: { enable: mock.fn() },
		...getPlugin
	};
	return {
		emitted,
		handlers,
		apis,
		eventBus: {
			emit(name, payload) {
				emitted.push({ name, payload });
				for (const handler of handlers.get(name) ?? []) {
					handler(payload);
				}
			},
			on(name, handler) {
				handlers.set(name, [...(handlers.get(name) ?? []), handler]);
			},
			off(name, handler) {
				handlers.set(
					name,
					(handlers.get(name) ?? []).filter((h) => h !== handler)
				);
			}
		},
		getPlugin(name) {
			return apis[name];
		}
	};
}

describe('controlInputs', () => {
	test('returns inputs matching the selector and skips other elements', async () => {
		await installDom();
		document.body.innerHTML = `
			<form id="group"><input type="radio" name="shapefile" value="a"><input type="radio" name="shapefile" value="b"></form>
			<div class="controls" id="not-an-input"></div>`;
		assert.equal(controlInputs('#group input[name="shapefile"]').length, 2);
		assert.deepEqual(controlInputs('#not-an-input'), []);
	});

	test('is empty for no selector or no document root', () => {
		assert.deepEqual(controlInputs(undefined), []);
		assert.deepEqual(controlInputs('input', null), []);
	});
});

describe('bindingForValue / featureForBinding', () => {
	test('finds the binding a control value names', () => {
		const bindings = [bindingFor('a'), bindingFor('b')];
		assert.equal(bindingForValue(bindings, 'b')?.datasetId, 'shapefile-b');
		assert.equal(bindingForValue(bindings, 'nope'), undefined);
	});

	test('resolves the dataset feature a binding names', () => {
		const binding = bindingFor('a');
		const datasets = [{ id: 'other' }, datasetFor(binding)];
		assert.equal(featureForBinding(datasets, binding)?.properties.fileKey, 'a');
		assert.equal(featureForBinding([{ id: binding.datasetId, geojson: {} }], binding), undefined);
		assert.equal(featureForBinding(datasets, { ...binding, featureId: 'missing' }), undefined);
		assert.equal(featureForBinding(datasets, { ...binding, datasetId: 'missing' }), undefined);
	});
});

describe('featureMatchesBinding', () => {
	test('matches a selection entry on featureId, on the fill or -stroke layer', () => {
		const binding = bindingFor('a');
		assert.equal(featureMatchesBinding(undefined, binding), false);
		assert.equal(featureMatchesBinding({ featureId: 'a', layerId: 'shapefile-a' }, binding), true);
		assert.equal(featureMatchesBinding({ featureId: 'a', layerId: 'shapefile-a-stroke' }, binding), true);
		assert.equal(featureMatchesBinding({ featureId: 'a', layerId: 'other' }, binding), false);
		// a click can come back without a layerId - featureId alone still matches
		assert.equal(featureMatchesBinding({ featureId: 'a' }, binding), true);
		// feature ids arrive as whatever the idProperty held - compare loosely
		assert.equal(
			featureMatchesBinding({ featureId: 'a', layerId: 'shapefile-a' }, { ...binding, featureId: 'a' }),
			true
		);
	});

	test('falls back to the feature properties when featureId is absent', () => {
		const binding = bindingFor('a');
		assert.equal(featureMatchesBinding({ layerId: 'shapefile-a', properties: { fileKey: 'a' } }, binding), true);
		assert.equal(featureMatchesBinding({ layerId: 'shapefile-a', properties: {} }, binding), false);
		assert.equal(featureMatchesBinding({ layerId: 'shapefile-a' }, binding), false);
		// a binding without a layerId still matches on featureId
		assert.equal(
			featureMatchesBinding({ featureId: 'a', layerId: 'whatever' }, { ...binding, layerId: undefined }),
			true
		);
	});
});

describe('applySelection', () => {
	const servicesWithApis = () => fakeServices();
	const inputsFor = (selection = { features: [] }) => selection;

	test('shows the chosen dataset and emits interact:selectFeature with the enriched feature', () => {
		const services = servicesWithApis();
		const binding = bindingFor('a');
		const datasets = [datasetFor(binding)];
		const selection = inputsFor();
		applySelection({
			binding,
			bindings: [binding],
			datasets,
			pluginConfig: {},
			services,
			mapProvider: {},
			selection,
			interactActive: true
		});
		assert.equal(services.apis.datasets.setDatasetVisibility.mock.callCount(), 1);
		assert.deepEqual(services.apis.datasets.setDatasetVisibility.mock.calls[0].arguments, [
			true,
			{ datasetId: 'shapefile-a' }
		]);
		const select = services.emitted.find((event) => event.name === 'interact:selectFeature');
		assert.equal(select.payload.featureId, 'a');
		assert.equal(select.payload.idProperty, 'fileKey');
		assert.equal(select.payload.properties.name, 'File a');
		assert.equal(select.payload.geometry.type, 'Polygon');
		// interact is known to be listening: the tracked selection is not speculative
		assert.equal(selection.features[0].speculative, false);
	});

	test('marks the tracked selection speculative while interact is not active', () => {
		const services = servicesWithApis();
		const binding = bindingFor('a');
		const selection = inputsFor();
		applySelection({
			binding,
			bindings: [binding],
			datasets: [datasetFor(binding)],
			pluginConfig: {},
			services,
			mapProvider: {},
			selection,
			interactActive: false
		});
		assert.equal(selection.features[0].speculative, true);
	});

	test('does not re-select an already selected feature - selectFeature toggles', () => {
		const services = servicesWithApis();
		const binding = bindingFor('a');
		applySelection({
			binding,
			bindings: [binding],
			datasets: [datasetFor(binding)],
			pluginConfig: {},
			services,
			mapProvider: {},
			selection: { features: [{ featureId: 'a', layerId: 'shapefile-a-stroke' }] }
		});
		assert.equal(services.emitted.filter((e) => e.name === 'interact:selectFeature').length, 0);
	});

	test("emphasis 'solo' hides the other bound datasets", () => {
		const services = servicesWithApis();
		const bindings = [bindingFor('a'), bindingFor('b'), bindingFor('c')];
		applySelection({
			binding: bindings[1],
			bindings,
			datasets: bindings.map((b) => datasetFor(b)),
			pluginConfig: { emphasis: 'solo' },
			services,
			mapProvider: {},
			selection: inputsFor()
		});
		const calls = services.apis.datasets.setDatasetVisibility.mock.calls.map((call) => call.arguments);
		assert.deepEqual(calls, [
			[true, { datasetId: 'shapefile-b' }],
			[false, { datasetId: 'shapefile-a' }],
			[false, { datasetId: 'shapefile-c' }]
		]);
	});

	test("emphasis 'dim' fades the others and restores the chosen dataset's own opacity", () => {
		const services = servicesWithApis();
		const bindings = [bindingFor('a'), bindingFor('b')];
		const datasets = [datasetFor(bindings[0], { opacity: 0.6 }), datasetFor(bindings[1])];
		applySelection({
			binding: bindings[1],
			bindings,
			datasets,
			pluginConfig: { emphasis: 'dim' },
			services,
			mapProvider: {},
			selection: inputsFor()
		});
		const calls = services.apis.datasets.setOpacity.mock.calls.map((call) => call.arguments);
		assert.deepEqual(calls, [
			[0.25, { datasetId: 'shapefile-a' }],
			[1, { datasetId: 'shapefile-b' }]
		]);
	});

	test("'dim' honours a configured dimOpacity", () => {
		const services = servicesWithApis();
		const bindings = [bindingFor('a'), bindingFor('b')];
		applySelection({
			binding: bindings[0],
			bindings,
			datasets: bindings.map((b) => datasetFor(b)),
			pluginConfig: { emphasis: 'dim', dimOpacity: 0.1 },
			services,
			mapProvider: {},
			selection: inputsFor()
		});
		assert.deepEqual(services.apis.datasets.setOpacity.mock.calls[0].arguments, [0.1, { datasetId: 'shapefile-b' }]);
	});

	test('zoomTo always fits the view to the bound feature', () => {
		const services = servicesWithApis();
		const binding = bindingFor('a');
		const mapProvider = { fitToBounds: mock.fn() };
		applySelection({
			binding,
			bindings: [binding],
			datasets: [datasetFor(binding)],
			pluginConfig: { zoomTo: 'always' },
			services,
			mapProvider,
			selection: inputsFor()
		});
		assert.equal(mapProvider.fitToBounds.mock.callCount(), 1);
		assert.equal(mapProvider.fitToBounds.mock.calls[0].arguments[0].properties.fileKey, 'a');
	});

	test('zoomTo never (and an unresolvable feature) leave the view alone', () => {
		const services = servicesWithApis();
		const binding = bindingFor('a');
		const mapProvider = { fitToBounds: mock.fn() };
		applySelection({
			binding,
			bindings: [binding],
			datasets: [datasetFor(binding)],
			pluginConfig: { zoomTo: 'never' },
			services,
			mapProvider,
			selection: inputsFor()
		});
		applySelection({
			binding: { ...binding, featureId: 'missing' },
			bindings: [binding],
			datasets: [],
			pluginConfig: { zoomTo: 'always' },
			services,
			mapProvider,
			selection: inputsFor()
		});
		assert.equal(mapProvider.fitToBounds.mock.callCount(), 0);
	});

	test('ensureVisible: false leaves the layers menu alone', () => {
		const services = servicesWithApis();
		const binding = bindingFor('a');
		applySelection({
			binding,
			bindings: [binding],
			datasets: [datasetFor(binding)],
			pluginConfig: { ensureVisible: false },
			services,
			mapProvider: {},
			selection: inputsFor()
		});
		assert.equal(services.apis.datasets.setDatasetVisibility.mock.callCount(), 0);
	});

	test('a context without plugin APIs degrades to just the selection emit', () => {
		const services = fakeServices();
		services.getPlugin = () => undefined;
		const binding = bindingFor('a');
		applySelection({
			binding,
			bindings: [binding],
			datasets: [],
			pluginConfig: {},
			services,
			mapProvider: undefined,
			selection: inputsFor()
		});
		assert.equal(services.emitted.filter((e) => e.name === 'interact:selectFeature').length, 1);
	});

	test('missing services entirely is still safe', () => {
		applySelection({
			binding: bindingFor('a'),
			bindings: [bindingFor('a')],
			datasets: [],
			pluginConfig: { emphasis: 'dim', zoomTo: 'always' },
			services: undefined,
			mapProvider: undefined,
			selection: inputsFor()
		});
	});
});

describe('syncControlsFromSelection', () => {
	const makeInputs = (values) => values.map((value) => ({ value, checked: false }));

	test('checks the radio whose binding the selected feature belongs to', () => {
		const inputs = makeInputs(['a', 'b']);
		const bindings = [bindingFor('a'), bindingFor('b')];
		const applyToMap = mock.fn();
		const selection = { features: [] };
		syncControlsFromSelection({
			selectedFeatures: [{ featureId: 'b', layerId: 'shapefile-b' }],
			bindings,
			inputs,
			pluginConfig: {},
			selection,
			applyToMap
		});
		assert.equal(inputs[1].checked, true);
		assert.equal(inputs[0].checked, false);
		assert.equal(applyToMap.mock.callCount(), 0);
		assert.equal(selection.features.length, 1);
	});

	test('a bound feature with no matching input still stops at the first bound feature', () => {
		const inputs = makeInputs(['a']);
		const bindings = [bindingFor('b')];
		syncControlsFromSelection({
			selectedFeatures: [{ featureId: 'b', layerId: 'shapefile-b' }],
			bindings,
			inputs,
			pluginConfig: {},
			selection: { features: [] },
			applyToMap: mock.fn()
		});
		assert.equal(inputs[0].checked, false);
	});

	test('an empty selection re-asserts the checked control when persistent', () => {
		const inputs = makeInputs(['a', 'b']);
		inputs[1].checked = true;
		const bindings = [bindingFor('a'), bindingFor('b')];
		const applyToMap = mock.fn();
		syncControlsFromSelection({
			selectedFeatures: [],
			bindings,
			inputs,
			pluginConfig: {},
			selection: { features: [{ featureId: 'b' }] },
			applyToMap
		});
		assert.equal(applyToMap.mock.callCount(), 1);
		assert.equal(applyToMap.mock.calls[0].arguments[0].value, 'b');
	});

	test('an empty selection with persistent: false leaves the map cleared', () => {
		const inputs = makeInputs(['a']);
		inputs[0].checked = true;
		const applyToMap = mock.fn();
		syncControlsFromSelection({
			selectedFeatures: [],
			bindings: [bindingFor('a')],
			inputs,
			pluginConfig: { persistent: false },
			selection: { features: [] },
			applyToMap
		});
		assert.equal(applyToMap.mock.callCount(), 0);
	});

	test('an empty selection with nothing checked (or checked but unbound) does nothing', () => {
		const applyToMap = mock.fn();
		const unbound = makeInputs(['zzz']);
		unbound[0].checked = true;
		for (const inputs of [makeInputs(['a']), unbound]) {
			syncControlsFromSelection({
				selectedFeatures: [],
				bindings: [bindingFor('a')],
				inputs,
				pluginConfig: {},
				selection: { features: [] },
				applyToMap
			});
		}
		assert.equal(applyToMap.mock.callCount(), 0);
	});

	test('a selection of only unbound features does not touch the radios', () => {
		const inputs = makeInputs(['a']);
		const applyToMap = mock.fn();
		syncControlsFromSelection({
			selectedFeatures: [{ featureId: 'other', layerId: 'project-site' }],
			bindings: [bindingFor('a')],
			inputs,
			pluginConfig: {},
			selection: { features: [] },
			applyToMap
		});
		assert.equal(inputs[0].checked, false);
		assert.equal(applyToMap.mock.callCount(), 0);
	});
});

describe('createExternalControlsPlugin', () => {
	test('returns a plugin descriptor whose load resolves the manifest', async () => {
		const plugin = createExternalControlsPlugin({ control: 'input' });
		assert.equal(plugin.id, 'externalControls');
		assert.equal(plugin.control, 'input');
		const manifest = await plugin.load();
		assert.equal(typeof manifest.InitComponent, 'function');
	});

	test("primaryControl 'external' removes bound datasets (and their sublayers) from the Layers menu", () => {
		const datasets = [
			{ id: 'shapefile-a', showInMenu: true, sublayers: [{ id: 's1', showInMenu: true }] },
			// a bound dataset with no sublayers at all still leaves the menu
			{ id: 'shapefile-c', showInMenu: true },
			{ id: 'project-site', showInMenu: true }
		];
		createExternalControlsPlugin({
			bindings: [bindingFor('a'), bindingFor('c')],
			datasets,
			primaryControl: 'external'
		});
		assert.equal(datasets[0].showInMenu, false);
		assert.equal(datasets[0].sublayers[0].showInMenu, false);
		assert.equal(datasets[1].showInMenu, false);
		assert.equal(datasets[2].showInMenu, true);
	});

	test('each call returns a fresh manifest so per-map configs cannot bleed between instances', async () => {
		// the map framework caches the wrapped InitComponent globally by component
		// identity - a shared manifest would give every map the first map's config
		const a = await createExternalControlsPlugin({ control: '#a input' }).load();
		const b = await createExternalControlsPlugin({ control: '#b input' }).load();
		assert.notEqual(a, b);
		assert.notEqual(a.InitComponent, b.InitComponent);
	});

	test('shared control leaves the datasets untouched, and no datasets is fine', () => {
		const datasets = [{ id: 'shapefile-a', showInMenu: true }];
		createExternalControlsPlugin({ bindings: [bindingFor('a')], datasets });
		assert.equal(datasets[0].showInMenu, true);
		createExternalControlsPlugin({ primaryControl: 'external', bindings: [bindingFor('a')] });
	});
});

describe('InitComponent', () => {
	const mount = async (props) => {
		const plugin = createExternalControlsPlugin(props.pluginConfig ?? {});
		const manifest = await plugin.load();
		const container = document.createElement('div');
		document.body.appendChild(container);
		compat.render(compat.createElement(manifest.InitComponent, props), container);
		await flushEffects();
		return container;
	};

	test('renders nothing without the map bundle compat, and nothing at all anyway', async () => {
		const plugin = createExternalControlsPlugin();
		const manifest = await plugin.load();
		assert.equal(manifest.InitComponent({ pluginConfig: {} }), null);

		await installDom();
		const container = await mount({ pluginConfig: {}, services: fakeServices() });
		assert.equal(container.innerHTML, '');
	});

	test('a services context without an eventBus or getPlugin is still safe', async () => {
		await installDom();
		document.body.innerHTML = '<input name="shapefile" value="a" checked>';
		await mount({ pluginConfig: { control: 'input', bindings: [bindingFor('a')] }, services: {} });
	});

	test('no services prop at all is still safe', async () => {
		await installDom();
		document.body.innerHTML = '<input name="shapefile" value="a" checked>';
		const container = await mount({ pluginConfig: { control: 'input', bindings: [bindingFor('a')] } });
		assert.equal(container.innerHTML, '');
	});

	test('a selectionchange carrying no payload leaves the radios untouched', async () => {
		await installDom();
		document.body.innerHTML = '<form id="group"><input type="radio" name="shapefile" value="a"></form>';
		const services = fakeServices();
		await mount({
			pluginConfig: {
				control: '#group input',
				bindings: [bindingFor('a')],
				datasets: [datasetFor(bindingFor('a'))]
			},
			services,
			mapProvider: {}
		});
		services.eventBus.emit('interact:selectionchange');
		assert.equal(document.querySelector('input').checked, false);
		// readiness with nothing checked applies nothing
		services.eventBus.emit('datasets:ready');
		assert.equal(services.emitted.filter((e) => e.name === 'interact:selectFeature').length, 0);
	});

	test('wires nothing when there are no bindings or no matching inputs', async () => {
		await installDom();
		document.body.innerHTML = '<input name="shapefile" value="a">';
		const services = fakeServices();
		// no bindings
		await mount({ pluginConfig: { control: 'input' }, services });
		assert.equal(services.handlers.size, 0);
		// bindings but the selector matches nothing
		await mount({ pluginConfig: { control: '#missing input', bindings: [bindingFor('a')] }, services });
		assert.equal(services.handlers.size, 0);
	});

	test('a radio change emits a selection, and a selection checks the radio', async () => {
		await installDom();
		document.body.innerHTML = `
			<form id="group">
				<input type="radio" name="shapefile" value="a">
				<input type="radio" name="shapefile" value="b">
				<input type="radio" name="shapefile" value="unbound">
			</form>`;
		const services = fakeServices();
		const bindings = [bindingFor('a'), bindingFor('b')];
		const datasets = bindings.map((b) => datasetFor(b));
		await mount({
			pluginConfig: { control: '#group input', bindings, datasets },
			services,
			mapProvider: {}
		});

		// a change before the map is ready is deferred - the DOM keeps the checked state
		const [radioA, radioB, radioUnbound] = document.querySelectorAll('input[name="shapefile"]');
		radioUnbound.checked = true;
		radioUnbound.dispatchEvent(new dom.window.Event('change'));
		radioB.checked = true;
		radioB.dispatchEvent(new dom.window.Event('change'));
		assert.equal(services.emitted.length, 0);
		assert.equal(services.apis.interact.enable.mock.callCount(), 0);

		// datasets:ready makes the map APIs safe: the checked radio's binding applies
		services.eventBus.emit('datasets:ready');
		assert.equal(services.apis.interact.enable.mock.callCount(), 1);
		const select = services.emitted.find((event) => event.name === 'interact:selectFeature');
		assert.equal(select.payload.featureId, 'b');

		// a change on an unchecked input is ignored
		const emitted = services.emitted.length;
		radioA.checked = false;
		radioA.dispatchEvent(new dom.window.Event('change'));
		assert.equal(services.emitted.length, emitted);

		// the map selecting a bound feature checks its radio
		services.eventBus.emit('interact:selectionchange', {
			selectedFeatures: [{ featureId: 'a', layerId: 'shapefile-a' }]
		});
		assert.equal(document.querySelector('input[value="a"]').checked, true);
	});

	test('a control checked before the map is ready replays when datasets/interact come up', async () => {
		await installDom();
		document.body.innerHTML = '<input type="radio" name="shapefile" value="a" checked>';
		const services = fakeServices();
		await mount({
			pluginConfig: { control: 'input', bindings: [bindingFor('a')], datasets: [datasetFor(bindingFor('a'))] },
			services,
			mapProvider: {}
		});
		// nothing touches the map until datasets:ready - the checked input is the pending state
		assert.equal(services.apis.interact.enable.mock.callCount(), 0);
		assert.equal(services.emitted.length, 0);

		// datasets:ready enables interact and selects; the emit is speculative because
		// interact:active has not fired - the emit may never have been heard
		services.eventBus.emit('datasets:ready');
		assert.equal(services.apis.interact.enable.mock.callCount(), 1);
		assert.equal(services.emitted.filter((e) => e.name === 'interact:selectFeature').length, 1);

		// interact:active clears the speculative mark and replays - the re-send covers
		// a dropped emit, and lands as a no-op on interact's side if the first one did
		services.eventBus.emit('interact:active');
		assert.equal(services.emitted.filter((e) => e.name === 'interact:selectFeature').length, 2);
		assert.equal(services.apis.interact.enable.mock.callCount(), 2);

		// further replays confirm the tracked selection and emit nothing - the
		// selectionchange-confirmed mark suppresses the re-send (selectFeature toggles)
		services.eventBus.emit('interact:active', { active: false });
		services.eventBus.emit('interact:active');
		services.eventBus.emit('datasets:ready');
		assert.equal(services.emitted.filter((e) => e.name === 'interact:selectFeature').length, 2);

		// an empty selectionchange clears tracking, so the persistent re-assert emits again
		services.eventBus.emit('interact:selectionchange', { selectedFeatures: [] });
		assert.equal(services.emitted.filter((e) => e.name === 'interact:selectFeature').length, 3);
	});

	test('app:ready gates the plugin only when no datasets are configured', async () => {
		await installDom();
		document.body.innerHTML = '<input type="radio" name="shapefile" value="a" checked>';

		// datasets configured: app:ready alone is not enough - mappedDatasets may be empty
		const services = fakeServices();
		await mount({
			pluginConfig: { control: 'input', bindings: [bindingFor('a')], datasets: [datasetFor(bindingFor('a'))] },
			services,
			mapProvider: {}
		});
		services.eventBus.emit('app:ready');
		assert.equal(services.emitted.filter((e) => e.name === 'interact:selectFeature').length, 0);

		// no datasets: app:ready suffices - there are no datasets api calls to protect
		const bareServices = fakeServices();
		await mount({
			pluginConfig: { control: 'input', bindings: [bindingFor('a')] },
			services: bareServices,
			mapProvider: {}
		});
		bareServices.eventBus.emit('app:ready');
		assert.equal(bareServices.emitted.filter((e) => e.name === 'interact:selectFeature').length, 1);
	});

	test('an empty selectionchange re-asserts the checked control', async () => {
		await installDom();
		document.body.innerHTML = '<input type="radio" name="shapefile" value="a" checked>';
		const services = fakeServices();
		const binding = bindingFor('a');
		await mount({
			pluginConfig: { control: 'input', bindings: [binding], datasets: [datasetFor(binding)] },
			services,
			mapProvider: {}
		});
		services.eventBus.emit('datasets:ready');
		const before = services.emitted.filter((e) => e.name === 'interact:selectFeature').length;
		// the map deselects (e.g. a click outside) - the radio's answer is re-applied
		services.eventBus.emit('interact:selectionchange', { selectedFeatures: [] });
		assert.equal(services.emitted.filter((e) => e.name === 'interact:selectFeature').length, before + 1);
	});

	test('the persistent re-assert is a no-op before readiness', async () => {
		await installDom();
		document.body.innerHTML = '<input type="radio" name="shapefile" value="a" checked>';
		const services = fakeServices();
		const binding = bindingFor('a');
		await mount({
			pluginConfig: { control: 'input', bindings: [binding], datasets: [datasetFor(binding)] },
			services,
			mapProvider: {}
		});
		// a deselect event before datasets:ready would re-assert the checked input,
		// but applyToMap refuses to touch the map while `ready` is false
		services.eventBus.emit('interact:selectionchange', { selectedFeatures: [] });
		assert.equal(services.emitted.filter((e) => e.name === 'interact:selectFeature').length, 0);
		// readiness then replays the checked input as normal
		services.eventBus.emit('datasets:ready');
		assert.equal(services.emitted.filter((e) => e.name === 'interact:selectFeature').length, 1);
	});

	test('unmounting removes the listeners', async () => {
		await installDom();
		document.body.innerHTML = '<input type="radio" name="shapefile" value="a">';
		const services = fakeServices();
		const container = await mount({
			pluginConfig: { control: 'input', bindings: [bindingFor('a')], datasets: [] },
			services,
			mapProvider: {}
		});
		compat.render(null, container);
		await flushEffects();
		for (const event of ['interact:selectionchange', 'interact:active', 'datasets:ready', 'app:ready']) {
			assert.equal(services.handlers.get(event).length, 0);
		}
		const input = document.querySelector('input');
		input.checked = true;
		input.dispatchEvent(new dom.window.Event('change'));
		assert.equal(services.emitted.length, 0);
	});
});
