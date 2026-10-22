import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import {
	AREA_UNITS,
	DISTANCE_UNITS,
	MeasureInit,
	MeasurePanel,
	boundingBoxRing,
	createMeasurePlugin,
	defaultUnitId,
	formatMeasurement,
	handleDrawCancelled,
	handleDrawCreated,
	handleDrawStarted,
	handleGeometryChange,
	haversineMetres,
	lineLengthMetres,
	measurementForCoordinates,
	ringAreaSquareMetres,
	startMeasure
} from './measure-plugin.mjs';

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
	return {
		handlers,
		on: mock.fn((event, handler) => {
			handlers[event] = handler;
		}),
		off: mock.fn(),
		emit: mock.fn()
	};
}

function fakeDrawPlugin(overrides = {}) {
	return {
		newLine: mock.fn(),
		deleteFeature: mock.fn(),
		addFeature: mock.fn(),
		...overrides
	};
}

function fakeDrawAdapter(overrides = {}) {
	const handlers = {};
	return {
		handlers,
		on: mock.fn((event, handler) => {
			handlers[event] = handler;
		}),
		off: mock.fn(),
		getMode: mock.fn(() => 'draw_line'),
		done: mock.fn(),
		...overrides
	};
}

function fakeServices({ draw = fakeDrawPlugin(), eventBus = fakeEventBus(), hints } = {}) {
	return {
		getPlugin: mock.fn((id) => (id === 'draw' ? draw : undefined)),
		eventBus,
		hints
	};
}

function fakeContext({
	pluginConfig = { modes: ['distance', 'path', 'area'], units: 'metric', pending: null },
	pluginState = { measurement: null, units: {}, dispatch: mock.fn() },
	services = fakeServices(),
	mapProvider = { draw: fakeDrawAdapter() }
} = {}) {
	return { pluginConfig, pluginState, services, mapProvider };
}

describe('measure-plugin geometry and units', () => {
	test('haversineMetres measures a known distance and is zero for a point', () => {
		// London to Paris is about 343 km
		const metres = haversineMetres([-0.1276, 51.5074], [2.3522, 48.8566]);
		assert.ok(metres > 335_000 && metres < 355_000, `got ${metres}`);
		assert.equal(haversineMetres([-2, 54], [-2, 54]), 0);
	});

	test('lineLengthMetres sums segments and tolerates empty input', () => {
		assert.equal(lineLengthMetres(), 0);
		assert.equal(lineLengthMetres([[-2, 54]]), 0);
		const twoPoints = lineLengthMetres([
			[-2, 54],
			[-2, 54.01]
		]);
		const withBend = lineLengthMetres([
			[-2, 54],
			[-2, 54.01],
			[-2.01, 54.01]
		]);
		assert.ok(withBend > twoPoints, 'a third vertex should add distance');
	});

	test('boundingBoxRing orders corners whichever diagonal was drawn', () => {
		const ring = boundingBoxRing([-2, 54], [-1, 55]);
		assert.deepEqual(ring, [
			[-2, 54],
			[-1, 54],
			[-1, 55],
			[-2, 55],
			[-2, 54]
		]);
		assert.deepEqual(boundingBoxRing([-1, 55], [-2, 54]), ring);
	});

	test('ringAreaSquareMetres measures a known box', () => {
		assert.equal(ringAreaSquareMetres(), 0);
		// a 1° x 1° box at the equator is about 12,360 km²
		const square = ringAreaSquareMetres([
			[0, 0],
			[1, 0],
			[1, 1],
			[0, 1],
			[0, 0]
		]);
		assert.ok(square > 12_000_000_000 && square < 12_800_000_000, `got ${square}`);
	});

	test('measurementForCoordinates needs two points and honours the mode', () => {
		assert.equal(measurementForCoordinates(), null);
		assert.equal(measurementForCoordinates('nope', 'distance'), null);
		assert.equal(measurementForCoordinates([[-2, 54]], 'distance'), null);
		assert.ok(
			measurementForCoordinates(
				[
					[-2, 54],
					[-1, 55]
				],
				'distance'
			).metres > 0
		);
		assert.ok(
			measurementForCoordinates(
				[
					[-2, 54],
					[-1, 55]
				],
				'path'
			).metres > 0
		);
		assert.ok(
			measurementForCoordinates(
				[
					[-2, 54],
					[-1, 55]
				],
				'area'
			).squareMetres > 0
		);
	});

	test('defaultUnitId resolves metric and imperial defaults', () => {
		assert.equal(defaultUnitId('imperial', 'distance'), 'ft');
		assert.equal(defaultUnitId('imperial', 'area'), 'ft2');
		assert.equal(defaultUnitId('metric', 'distance'), 'm');
		assert.equal(defaultUnitId('metric', 'area'), 'm2');
		assert.equal(defaultUnitId(undefined, 'distance'), 'm');
	});

	test('formatMeasurement converts distances and areas', () => {
		assert.equal(formatMeasurement(null, 'km'), '');
		assert.equal(formatMeasurement({ metres: 1500 }, 'km'), '1.5 km');
		assert.equal(formatMeasurement({ metres: 1500 }, 'm'), '1,500 m');
		assert.equal(formatMeasurement({ metres: 1609.344 }, 'mi'), '1 mi');
		assert.equal(formatMeasurement({ metres: 0.4 }, 'm'), '0.4 m');
		assert.match(formatMeasurement({ metres: 2 }, 'ft'), /ft$/);
		// unknown unit ids fall back to the kind's base unit
		assert.equal(formatMeasurement({ metres: 42 }, 'leagues'), '42 m');
		// a measurement with no figures yet formats as zero in the requested unit
		assert.equal(formatMeasurement({}, 'km'), '0 km');
		assert.equal(formatMeasurement({ squareMetres: 2_000_000 }, 'km2'), '2 km²');
		assert.equal(formatMeasurement({ squareMetres: 500 }, 'm2'), '500 m²');
		assert.match(formatMeasurement({ squareMetres: 100 }, 'ft2'), /ft²$/);
		assert.match(formatMeasurement({ squareMetres: 5_000_000 }, 'mi2'), /mi²$/);
		assert.match(formatMeasurement({ squareMetres: 0.05 }, 'm2'), /^0\.05/);
		assert.ok(DISTANCE_UNITS.length === 4 && AREA_UNITS.length === 4);
	});
});

describe('createMeasurePlugin descriptor', () => {
	test('defaults to the primary two-point distance tool with metric units', () => {
		const plugin = createMeasurePlugin();
		assert.equal(plugin.id, 'measure');
		assert.deepEqual(plugin.modes, ['distance']);
		assert.equal(plugin.units, 'metric');
		assert.equal(plugin.pending, null);
	});

	test('filters unknown modes, dedupes, and falls back when none remain', () => {
		assert.deepEqual(createMeasurePlugin({ modes: ['path', 'area', 'path', 'bogus'] }).modes, ['path', 'area']);
		assert.deepEqual(createMeasurePlugin({ modes: [] }).modes, ['distance']);
		assert.deepEqual(createMeasurePlugin({ modes: ['bogus'] }).modes, ['distance']);
		assert.deepEqual(createMeasurePlugin({ modes: 'distance' }).modes, ['distance']);
		assert.equal(createMeasurePlugin({ units: 'imperial' }).units, 'imperial');
		assert.equal(createMeasurePlugin({ units: 'yards' }).units, 'metric');
	});

	test('load() returns a manifest with a plain button for a single mode', async () => {
		const manifest = await createMeasurePlugin().load();
		assert.equal(manifest.buttons.length, 1);
		assert.equal(manifest.buttons[0].id, 'measure');
		assert.equal(manifest.buttons[0].menuItems, undefined);
		assert.equal(manifest.panels[0].id, 'measure');
		assert.equal(manifest.panels[0].focus, false);
		assert.equal(manifest.InitComponent, MeasureInit);
		assert.equal(typeof manifest.panels[0].render, 'function');
	});

	test('load() returns a menu with an item per configured mode', async () => {
		const manifest = await createMeasurePlugin({ modes: ['distance', 'path', 'area'] }).load();
		assert.deepEqual(
			manifest.buttons[0].menuItems.map((item) => item.id),
			['measure-distance', 'measure-path', 'measure-area']
		);
		assert.deepEqual(
			manifest.buttons[0].menuItems.map((item) => item.label),
			['Between two points', 'Along a path', 'Of a bounded box']
		);
	});

	test('manifest labels honour overrides and fall back to defaults', async () => {
		const manifest = await createMeasurePlugin({ buttonLabel: 'Ruler', panelLabel: 'Ruler results' }).load();
		assert.equal(manifest.buttons[0].label({ pluginConfig: { buttonLabel: 'Ruler' } }), 'Ruler');
		assert.equal(manifest.buttons[0].label({ pluginConfig: {} }), 'Measure');
		assert.equal(manifest.buttons[0].label({}), 'Measure');
		assert.equal(manifest.panels[0].label({ pluginConfig: { panelLabel: 'Ruler results' } }), 'Ruler results');
		assert.equal(manifest.panels[0].label({ pluginConfig: {} }), 'Measure');
		assert.equal(manifest.reducer.initialState.measurement, null);
	});

	test('reducer actions replace the measurement and merge unit choices', async () => {
		const { actions, initialState } = (await createMeasurePlugin().load()).reducer;
		const withMeasurement = actions.SET_MEASUREMENT(initialState, { mode: 'distance', status: 'done', metres: 5 });
		assert.equal(withMeasurement.measurement.metres, 5);
		const withUnits = actions.SET_UNIT(withMeasurement, { kind: 'distance', unit: 'km' });
		assert.deepEqual(withUnits.units, { distance: 'km' });
		const withArea = actions.SET_UNIT(withUnits, { kind: 'area', unit: 'mi2' });
		assert.deepEqual(withArea.units, { distance: 'km', area: 'mi2' });
	});
});

describe('startMeasure', () => {
	test('does nothing useful without the draw plugin or adapter', () => {
		const context = fakeContext({ services: fakeServices({ draw: null }) });
		startMeasure('distance', context);
		assert.deepEqual(context.pluginState.dispatch.mock.calls[0].arguments[0], {
			type: 'SET_MEASUREMENT',
			payload: { mode: 'distance', status: 'unavailable' }
		});
		assert.equal(context.pluginConfig.pending, null);

		// plugin without the api attached yet, and a context without pluginConfig
		startMeasure('distance', fakeContext({ services: fakeServices({ draw: {} }) }));
		startMeasure(
			'distance',
			fakeContext({ pluginConfig: undefined, services: fakeServices(), pluginState: { dispatch: mock.fn() } })
		);
		// no adapter mounted yet
		const notReady = fakeContext({ mapProvider: {} });
		startMeasure('distance', notReady);
		assert.equal(notReady.pluginState.dispatch.mock.calls.length, 1);
		// no context at all must not throw
		startMeasure('distance');
		startMeasure('distance', {});
	});

	test('starts a draw_line session, records the pending feature and shows the panel', () => {
		const context = fakeContext();
		const { eventBus } = context.services;
		context.services.hints = { show: mock.fn() };
		startMeasure('distance', context);

		assert.equal(context.pluginConfig.pending.mode, 'distance');
		assert.equal(context.pluginConfig.pending.expectStart, true);
		const [dispatched] = context.pluginState.dispatch.mock.calls;
		assert.deepEqual(dispatched.arguments[0].payload.status, 'drawing');
		assert.deepEqual(eventBus.emit.mock.calls[0].arguments, ['app:showpanel', { id: 'measure', focus: false }]);
		assert.equal(
			context.services.hints.show.mock.calls[0].arguments[0],
			'Click two points on the map to measure the distance between them.'
		);
		const drawPlugin = context.services.getPlugin('draw');
		const [featureId, style] = drawPlugin.newLine.mock.calls[0].arguments;
		assert.equal(featureId, context.pluginConfig.pending.id);
		assert.equal(style.strokeWidth, 3);
	});

	test('falls back to a timestamped id when crypto.randomUUID is missing', () => {
		const crypto = globalThis.crypto;
		delete globalThis.crypto;
		try {
			const context = fakeContext();
			startMeasure('path', context);
			assert.match(context.pluginConfig.pending.id, /^measure-\d+$/);
		} finally {
			globalThis.crypto = crypto;
		}
	});

	test('tolerates missing eventBus, hints and pluginState, and unknown mode labels', () => {
		const services = { getPlugin: () => fakeDrawPlugin() };
		const context = {
			pluginConfig: { pending: null },
			services,
			mapProvider: { draw: fakeDrawAdapter() }
		};
		startMeasure('made-up-mode', context);
		assert.equal(context.pluginConfig.pending.mode, 'made-up-mode');
	});
});

describe('handleGeometryChange', () => {
	const commitEvent = (coordinates, phase = 'commit-add') => ({
		phase,
		feature: { type: 'Feature', geometry: { type: 'LineString', coordinates } }
	});

	test('ignores events when no measure session is pending', () => {
		const context = fakeContext();
		handleGeometryChange(
			commitEvent([
				[-2, 54],
				[-1, 55]
			]),
			context
		);
		handleGeometryChange(
			commitEvent([
				[-2, 54],
				[-1, 55]
			]),
			undefined
		);
		handleGeometryChange(null, context);
		assert.equal(context.pluginState.dispatch.mock.calls.length, 0);
	});

	test('ignores non-commit phases, non-line features and malformed previews', () => {
		const context = fakeContext();
		context.pluginConfig.pending = { id: 'f1', mode: 'distance' };
		handleGeometryChange(
			commitEvent(
				[
					[-2, 54],
					[-1, 55]
				],
				'commit-move'
			),
			context
		);
		handleGeometryChange({ phase: 'commit-add', feature: { geometry: { type: 'Point' } } }, context);
		handleGeometryChange({ phase: 'commit-add' }, context);
		handleGeometryChange({ coordinates: 'nope' }, context);
		assert.equal(context.pluginState.dispatch.mock.calls.length, 0);
	});

	test('ignores previews when the adapter is not drawing a line', () => {
		const adapter = fakeDrawAdapter({ getMode: () => 'draw_polygon' });
		const context = fakeContext({ mapProvider: { draw: adapter } });
		context.pluginConfig.pending = { id: 'f1', mode: 'distance' };
		handleGeometryChange(
			{
				coordinates: [
					[-2, 54],
					[-1, 55]
				]
			},
			context
		);
		assert.equal(context.pluginState.dispatch.mock.calls.length, 0);

		context.mapProvider = { draw: {} };
		handleGeometryChange(
			{
				coordinates: [
					[-2, 54],
					[-1, 55]
				]
			},
			context
		);
		context.mapProvider = {};
		handleGeometryChange(
			{
				coordinates: [
					[-2, 54],
					[-1, 55]
				]
			},
			context
		);
		assert.equal(context.pluginState.dispatch.mock.calls.length, 0);
	});

	test('preview payloads update the live measurement including the cursor', () => {
		const context = fakeContext();
		context.pluginConfig.pending = { id: 'f1', mode: 'distance' };
		handleGeometryChange(
			{
				coordinates: [
					[-2, 54],
					[-2, 54.01]
				]
			},
			context
		);
		const [dispatched] = context.pluginState.dispatch.mock.calls;
		assert.equal(dispatched.arguments[0].type, 'SET_MEASUREMENT');
		assert.equal(dispatched.arguments[0].payload.status, 'drawing');
		assert.ok(dispatched.arguments[0].payload.metres > 1000);
	});

	test('the second committed vertex auto-finishes two-point modes', async () => {
		const context = fakeContext();
		context.pluginConfig.pending = { id: 'f1', mode: 'distance' };
		handleGeometryChange(
			commitEvent([
				[-2, 54],
				[-1, 55]
			]),
			context
		);
		assert.equal(context.pluginConfig.pending.autoFinished, true);
		await flushEffects();
		assert.equal(context.mapProvider.draw.done.mock.calls.length, 1);
		// a later commit does not finish again
		handleGeometryChange(
			commitEvent([
				[-2, 54],
				[-1, 55],
				[-1, 56]
			]),
			context
		);
		await flushEffects();
		assert.equal(context.mapProvider.draw.done.mock.calls.length, 1);
	});

	test('bounded-box mode also finishes on the second corner', async () => {
		const context = fakeContext();
		context.pluginConfig.pending = { id: 'f1', mode: 'area' };
		handleGeometryChange(
			commitEvent([
				[-2, 54],
				[-1, 55]
			]),
			context
		);
		const dispatched = context.pluginState.dispatch.mock.calls.at(-1).arguments[0];
		assert.ok(dispatched.payload.squareMetres > 0);
		await flushEffects();
		assert.equal(context.mapProvider.draw.done.mock.calls.length, 1);
	});

	test('path mode keeps drawing until Done - no auto-finish', async () => {
		const context = fakeContext();
		context.pluginConfig.pending = { id: 'f1', mode: 'path' };
		handleGeometryChange(
			commitEvent([
				[-2, 54],
				[-1, 55]
			]),
			context
		);
		await flushEffects();
		assert.equal(context.mapProvider.draw.done.mock.calls.length, 0);
		// and a single committed vertex does not finish or dispatch a figure
		context.pluginConfig.pending = { id: 'f2', mode: 'distance' };
		const callsBefore = context.pluginState.dispatch.mock.calls.length;
		handleGeometryChange(commitEvent([[-2, 54]]), context);
		await flushEffects();
		assert.equal(context.pluginState.dispatch.mock.calls.length, callsBefore);
		assert.equal(context.mapProvider.draw.done.mock.calls.length, 0);
	});

	test('auto-finish tolerates an adapter without done()', async () => {
		const context = fakeContext({ mapProvider: { draw: { getMode: () => 'draw_line' } } });
		context.pluginConfig.pending = { id: 'f1', mode: 'distance' };
		handleGeometryChange(
			commitEvent([
				[-2, 54],
				[-1, 55]
			]),
			context
		);
		await flushEffects();
	});
});

describe('draw event handlers', () => {
	test('handleDrawCreated ignores other features and non-lines', () => {
		const context = fakeContext();
		context.pluginConfig.pending = { id: 'f1', mode: 'distance' };
		handleDrawCreated(
			{
				id: 'other',
				geometry: {
					type: 'LineString',
					coordinates: [
						[-2, 54],
						[-1, 55]
					]
				}
			},
			context
		);
		assert.equal(context.pluginState.dispatch.mock.calls.length, 0);
		assert.ok(context.pluginConfig.pending);

		// ours but not a line - pending clears, nothing dispatches
		handleDrawCreated({ id: 'f1', geometry: { type: 'Point', coordinates: [-2, 54] } }, context);
		assert.equal(context.pluginConfig.pending, null);
		assert.equal(context.pluginState.dispatch.mock.calls.length, 0);

		handleDrawCreated({ id: 'f1' }, fakeContext());
	});

	test('handleDrawCreated reports the distance of the drawn line', () => {
		const context = fakeContext();
		context.pluginConfig.pending = { id: 'f1', mode: 'distance' };
		handleDrawCreated(
			{
				id: 'f1',
				geometry: {
					type: 'LineString',
					coordinates: [
						[-2, 54],
						[-2, 54.01]
					]
				}
			},
			context
		);
		const payload = context.pluginState.dispatch.mock.calls[0].arguments[0].payload;
		assert.equal(payload.status, 'done');
		assert.equal(payload.featureId, 'f1');
		assert.ok(payload.metres > 1000);
		assert.equal(context.pluginConfig.pending, null);
	});

	test('handleDrawCreated swaps the area diagonal for its bounding box', () => {
		const draw = fakeDrawPlugin();
		const context = fakeContext({ services: fakeServices({ draw }) });
		context.pluginConfig.pending = { id: 'f1', mode: 'area' };
		handleDrawCreated(
			{
				id: 'f1',
				geometry: {
					type: 'LineString',
					coordinates: [
						[-2, 54],
						[-1, 55]
					]
				}
			},
			context
		);

		assert.deepEqual(draw.deleteFeature.mock.calls[0].arguments[0], ['f1']);
		const added = draw.addFeature.mock.calls[0].arguments[0];
		assert.equal(added.id, 'f1');
		assert.equal(added.geometry.type, 'Polygon');
		assert.equal(added.geometry.coordinates[0].length, 5);

		const payload = context.pluginState.dispatch.mock.calls[0].arguments[0].payload;
		assert.equal(payload.status, 'done');
		assert.ok(payload.squareMetres > 0);

		// a finished line with too few vertices measures nothing
		context.pluginConfig.pending = { id: 'f2', mode: 'area' };
		const calls = context.pluginState.dispatch.mock.calls.length;
		handleDrawCreated({ id: 'f2', geometry: { type: 'LineString', coordinates: [[-2, 54]] } }, context);
		assert.equal(context.pluginState.dispatch.mock.calls.length, calls);

		// and the swap still works if the draw plugin has gone
		const bare = fakeContext({ services: { getPlugin: () => undefined } });
		bare.pluginConfig.pending = { id: 'f3', mode: 'area' };
		handleDrawCreated(
			{
				id: 'f3',
				geometry: {
					type: 'LineString',
					coordinates: [
						[-2, 54],
						[-1, 55]
					]
				}
			},
			bare
		);
		assert.equal(bare.pluginState.dispatch.mock.calls[0].arguments[0].payload.status, 'done');
	});

	test('handleDrawCancelled clears the pending session and reports it', () => {
		const context = fakeContext();
		handleDrawCancelled(context); // no pending: a no-op
		context.pluginConfig.pending = { id: 'f1', mode: 'distance' };
		handleDrawCancelled(context);
		assert.equal(context.pluginConfig.pending, null);
		assert.deepEqual(context.pluginState.dispatch.mock.calls[0].arguments[0].payload, {
			mode: 'distance',
			status: 'cancelled'
		});
	});

	test('handleDrawStarted consumes the expected start and drops others', () => {
		const context = fakeContext();
		handleDrawStarted(context); // no pending: a no-op
		context.pluginConfig.pending = { id: 'f1', mode: 'distance', expectStart: true };
		handleDrawStarted(context);
		assert.equal(context.pluginConfig.pending.expectStart, false);
		// a later session that wasn't ours stops us listening
		handleDrawStarted(context);
		assert.equal(context.pluginConfig.pending, null);
	});
});

describe('MeasurePanel', () => {
	const renderPanel = async (props) => {
		await installDom();
		const container = document.createElement('div');
		document.body.appendChild(container);
		compat.render(compat.createElement(MeasurePanel, props), container);
		return container;
	};

	const doneMeasurement = { mode: 'distance', status: 'done', metres: 1500, featureId: 'f1' };

	test('shows how to start when there is no measurement', async () => {
		const container = await renderPanel({ pluginConfig: {}, pluginState: {} });
		assert.match(container.textContent, /Choose a measure tool/);
		assert.equal(container.querySelector('select'), null);
	});

	test('shows the mode hint while drawing, with a fallback for unknown modes', async () => {
		const pluginState = { measurement: { mode: 'distance', status: 'drawing' } };
		const container = await renderPanel({ pluginConfig: {}, pluginState });
		assert.match(container.textContent, /Click two points/);

		const other = await renderPanel({
			pluginConfig: {},
			pluginState: { measurement: { mode: 'wibble', status: 'drawing' } }
		});
		assert.match(other.textContent, /Draw on the map/);
	});

	test('shows cancelled and unavailable states', async () => {
		const cancelled = await renderPanel({
			pluginConfig: {},
			pluginState: { measurement: { mode: 'distance', status: 'cancelled' } }
		});
		assert.match(cancelled.textContent, /cancelled/);

		const unavailable = await renderPanel({
			pluginConfig: {},
			pluginState: { measurement: { mode: 'distance', status: 'unavailable' } }
		});
		assert.match(unavailable.textContent, /not available/);
	});

	test('shows the live result in the default metric unit with a units select', async () => {
		const container = await renderPanel({
			pluginConfig: { units: 'metric' },
			pluginState: { measurement: { mode: 'distance', status: 'drawing', metres: 1500 }, units: {} }
		});
		assert.match(container.textContent, /1\.5 km|1,500 m/);
		const select = container.querySelector('select');
		assert.ok(select);
		assert.equal(select.value, 'm');
		assert.equal(select.options.length, 4);
	});

	test('honours an imperial default and a chosen unit, including for areas', async () => {
		const imperial = await renderPanel({
			pluginConfig: { units: 'imperial' },
			pluginState: { measurement: doneMeasurement, units: {} }
		});
		assert.equal(imperial.querySelector('select').value, 'ft');
		assert.match(imperial.textContent, /ft/);

		const chosen = await renderPanel({
			pluginConfig: {},
			pluginState: { measurement: { mode: 'area', status: 'done', squareMetres: 2_000_000 }, units: { area: 'km2' } }
		});
		assert.equal(chosen.querySelector('select').value, 'km2');
		assert.match(chosen.textContent, /2 km²/);
		assert.equal(chosen.querySelector('select').options.length, 4);
	});

	test('switching units dispatches SET_UNIT for that kind', async () => {
		const pluginState = { measurement: doneMeasurement, units: {}, dispatch: mock.fn() };
		const container = await renderPanel({ pluginConfig: {}, pluginState, appConfig: { id: 'demo' } });
		const select = container.querySelector('select');
		assert.equal(select.id, 'demo-measure-units');
		select.value = 'km';
		select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
		assert.deepEqual(pluginState.dispatch.mock.calls[0].arguments[0], {
			type: 'SET_UNIT',
			payload: { kind: 'distance', unit: 'km' }
		});
	});

	test('Clear removes the measured shape and resets the panel', async () => {
		const draw = fakeDrawPlugin();
		const pluginState = { measurement: doneMeasurement, units: {}, dispatch: mock.fn() };
		const container = await renderPanel({
			pluginConfig: {},
			pluginState,
			services: fakeServices({ draw })
		});
		const button = container.querySelector('button.govuk-button--secondary');
		assert.ok(button);
		button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
		await flushEffects();
		assert.deepEqual(draw.deleteFeature.mock.calls[0].arguments[0], ['f1']);
		assert.deepEqual(pluginState.dispatch.mock.calls[0].arguments[0], { type: 'SET_MEASUREMENT', payload: null });
	});

	test('Clear without a feature id or services still resets', async () => {
		const pluginState = {
			measurement: { mode: 'distance', status: 'done', metres: 5 },
			units: {},
			dispatch: mock.fn()
		};
		const container = await renderPanel({ pluginConfig: {}, pluginState });
		container.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
		await flushEffects();
		assert.equal(pluginState.dispatch.mock.calls.length, 1);
	});

	test('the manifest shell renders nothing without preactCompat', async () => {
		const manifest = await createMeasurePlugin().load();
		assert.equal(manifest.panels[0].render({ pluginConfig: {} }), null);
		await installDom();
		const container = document.createElement('div');
		document.body.appendChild(container);
		compat.render(compat.createElement(manifest.panels[0].render, { pluginConfig: {}, pluginState: {} }), container);
		assert.match(container.textContent, /Choose a measure tool/);
	});
});

describe('MeasureInit', () => {
	const renderInit = async (props) => {
		await installDom();
		const container = document.createElement('div');
		document.body.appendChild(container);
		compat.render(compat.createElement(MeasureInit, props), container);
		await flushEffects();
		return container;
	};

	test('wires a menu item per configured mode and cleans up on unmount', async () => {
		const buttonConfig = { 'measure-distance': {}, 'measure-path': {}, 'measure-area': {} };
		// the real menu's activate context lacks pluginConfig/pluginState, so the wired
		// handler must use the component's injected context rather than the click args
		const context = fakeContext();
		const container = await renderInit({ ...context, buttonConfig });
		for (const id of Object.keys(buttonConfig)) {
			assert.equal(typeof buttonConfig[id].onClick, 'function');
		}
		buttonConfig['measure-area'].onClick(null, {});
		assert.equal(context.pluginConfig.pending.mode, 'area');
		buttonConfig['measure-path'].onClick(null, undefined);
		assert.equal(context.pluginConfig.pending.mode, 'path');
		compat.render(null, container);
		await flushEffects();
		for (const id of Object.keys(buttonConfig)) {
			assert.equal(buttonConfig[id].onClick, null);
		}
	});

	test('wires the button itself when only one mode is configured', async () => {
		const buttonConfig = { measure: {} };
		const context = fakeContext({ pluginConfig: { modes: ['distance'], pending: null } });
		const container = await renderInit({ ...context, buttonConfig });
		assert.equal(typeof buttonConfig.measure.onClick, 'function');
		buttonConfig.measure.onClick(null, {});
		assert.equal(context.pluginConfig.pending.mode, 'distance');
		compat.render(null, container);
		await flushEffects();
		assert.equal(buttonConfig.measure.onClick, null);
	});

	test('tolerates missing buttonConfig, absent items and a single-mode default', async () => {
		await renderInit({});
		await renderInit({ pluginConfig: {}, buttonConfig: {} });
		// pluginConfig without modes uses the distance default for the single-mode wiring
		const buttonConfig = { measure: {} };
		await renderInit({ pluginConfig: {}, buttonConfig });
		assert.equal(typeof buttonConfig.measure.onClick, 'function');
	});

	test('subscribes to draw events and attaches to the adapter on draw:ready', async () => {
		const eventBus = fakeEventBus();
		const adapter = fakeDrawAdapter();
		const pluginConfig = { modes: ['distance'], pending: null };
		const pluginState = { measurement: null, units: {}, dispatch: mock.fn() };
		await renderInit({
			pluginConfig,
			pluginState,
			services: fakeServices({ eventBus }),
			mapProvider: { draw: adapter }
		});

		assert.deepEqual(adapter.on.mock.calls[0].arguments[0], 'geometrychange');
		for (const event of ['draw:created', 'draw:cancelled', 'draw:started', 'draw:ready']) {
			assert.equal(typeof eventBus.handlers[event], 'function', `handler for ${event}`);
		}

		// a committed second vertex flows through the adapter subscription
		pluginConfig.pending = { id: 'f1', mode: 'distance', expectStart: true };
		eventBus.handlers['draw:started']({ mode: 'draw_line' });
		adapter.handlers.geometrychange({
			phase: 'commit-add',
			feature: {
				type: 'Feature',
				geometry: {
					type: 'LineString',
					coordinates: [
						[-2, 54],
						[-1, 55]
					]
				}
			}
		});
		eventBus.handlers['draw:created']({
			id: 'f1',
			geometry: {
				type: 'LineString',
				coordinates: [
					[-2, 54],
					[-1, 55]
				]
			}
		});
		assert.equal(pluginState.dispatch.mock.calls.at(-1).arguments[0].payload.status, 'done');

		// cancelling a later session reports through the same subscription
		pluginConfig.pending = { id: 'f2', mode: 'path' };
		eventBus.handlers['draw:cancelled']();
		assert.equal(pluginState.dispatch.mock.calls.at(-1).arguments[0].payload.status, 'cancelled');
	});

	test('reattaches when draw:ready reports a new adapter and detaches on unmount', async () => {
		const eventBus = fakeEventBus();
		const mapProvider = { draw: fakeDrawAdapter() };
		const container = await renderInit({
			pluginConfig: { modes: ['distance'] },
			pluginState: {},
			services: fakeServices({ eventBus }),
			mapProvider
		});
		// an adapter without .on is skipped
		mapProvider.draw = {};
		eventBus.handlers['draw:ready']();
		// and a real one reattaches
		mapProvider.draw = fakeDrawAdapter();
		eventBus.handlers['draw:ready']();
		assert.equal(mapProvider.draw.on.mock.calls.length, 1);
		// mapProvider without draw at attach time is fine too
		mapProvider.draw = null;
		eventBus.handlers['draw:ready']();

		compat.render(null, container);
		await flushEffects();
		assert.equal(mapProvider.draw, null);
	});

	test('does nothing when services has no event bus', async () => {
		await renderInit({ pluginConfig: { modes: ['distance'] }, services: {} });
	});
});
