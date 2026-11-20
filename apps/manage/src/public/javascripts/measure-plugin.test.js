import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import {
	AREA_UNITS,
	DISTANCE_UNITS,
	MeasureInit,
	MeasurePanel,
	clearMeasurements,
	createMeasurePlugin,
	defaultUnitId,
	formatMeasurement,
	handleDrawCancelled,
	handleDrawCreated,
	handleDrawEdited,
	handleDrawStarted,
	handleGeometryChange,
	haversineMetres,
	lineLengthMetres,
	measurementForCoordinates,
	ringAreaSquareMetres,
	startEdit,
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
		newPolygon: mock.fn(),
		editFeature: mock.fn(() => true),
		deleteFeature: mock.fn(),
		addFeature: mock.fn(),
		...overrides
	};
}

function fakeMap(overrides = {}) {
	return {
		on: mock.fn(),
		off: mock.fn(),
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
		cancel: mock.fn(),
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
	pluginConfig = {
		modes: ['distance', 'path', 'area'],
		units: 'metric',
		pending: null,
		editing: null,
		drawnFeatureIds: [],
		drawnFeatureModes: {}
	},
	pluginState = { measurement: null, units: {}, dispatch: mock.fn() },
	services = fakeServices(),
	mapProvider = { draw: fakeDrawAdapter(), map: fakeMap() }
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

	test('measurementForCoordinates needs two points for a line and honours the mode', () => {
		assert.equal(measurementForCoordinates(), null);
		assert.equal(measurementForCoordinates('nope', 'distance'), null);
		assert.equal(measurementForCoordinates([[-2, 54]], 'distance'), null);
		// a point's flat [lng, lat] is not a line
		assert.equal(measurementForCoordinates([-2, 54], 'distance'), null);
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
	});

	test('measurementForCoordinates measures a polygon ring for the area mode', () => {
		const ring = [
			[0, 0],
			[1, 0],
			[1, 1],
			[0, 1],
			[0, 0]
		];
		assert.equal(measurementForCoordinates(ring, 'area'), null); // a bare ring is not a polygon's coords
		assert.equal(measurementForCoordinates([[]], 'area'), null);
		assert.equal(
			measurementForCoordinates(
				[
					[
						[-2, 54],
						[-1, 55]
					]
				],
				'area'
			),
			null
		); // too few vertices
		assert.ok(measurementForCoordinates([ring], 'area').squareMetres > 12_000_000_000);
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
		assert.equal(plugin.editing, null);
		assert.deepEqual(plugin.drawnFeatureIds, []);
		assert.deepEqual(plugin.drawnFeatureModes, {});
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

	test('load() returns a menu with an item per configured mode plus a clear item', async () => {
		const manifest = await createMeasurePlugin({ modes: ['distance', 'path', 'area'] }).load();
		assert.deepEqual(
			manifest.buttons[0].menuItems.map((item) => item.id),
			['measure-distance', 'measure-path', 'measure-area', 'measure-clear']
		);
		assert.deepEqual(
			manifest.buttons[0].menuItems.map((item) => item.label),
			['Between two points', 'Along a path', 'Of an area', 'Clear measurements']
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

	test('area sessions draw a native polygon, not a line', () => {
		const context = fakeContext();
		startMeasure('area', context);
		const drawPlugin = context.services.getPlugin('draw');
		assert.equal(drawPlugin.newLine.mock.calls.length, 0);
		const [featureId, style] = drawPlugin.newPolygon.mock.calls[0].arguments;
		assert.equal(featureId, context.pluginConfig.pending.id);
		assert.equal(style.stroke, '#1d70b8');
		assert.ok(style.fill);
	});

	test('starting a tool mid-edit commits the edit session first', () => {
		const context = fakeContext();
		context.pluginConfig.editing = { id: 'f1', mode: 'area', previous: null };
		startMeasure('distance', context);
		assert.equal(context.mapProvider.draw.done.mock.calls.length, 1);
		assert.equal(context.pluginConfig.editing, null);
		assert.equal(context.pluginConfig.pending.mode, 'distance');
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

	test('ignores malformed events, and other commit phases refresh without finishing', async () => {
		const context = fakeContext();
		context.pluginConfig.pending = { id: 'f1', mode: 'path' };
		handleGeometryChange({ phase: 'commit-add' }, context);
		handleGeometryChange({ phase: 'commit-add', feature: {} }, context);
		handleGeometryChange({ coordinates: 'nope' }, context);
		assert.equal(context.pluginState.dispatch.mock.calls.length, 0);

		// a non-add commit still refreshes the readout (e.g. an invalid create reopened
		// in edit_vertex being fixed) - but it never auto-finishes the session
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
		assert.equal(context.pluginState.dispatch.mock.calls.length, 1);
		await flushEffects();
		assert.equal(context.mapProvider.draw.done.mock.calls.length, 0);
	});

	test('ignores previews from a mode the pending session is not running', () => {
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

	test('area sessions take polygon previews - and reopened invalid ones in edit_vertex', () => {
		const adapter = fakeDrawAdapter({ getMode: () => 'draw_polygon' });
		const context = fakeContext({ mapProvider: { draw: adapter } });
		context.pluginConfig.pending = { id: 'f1', mode: 'area' };
		handleGeometryChange(
			{
				coordinates: [
					[
						[0, 0],
						[1, 0],
						[1, 1],
						[0, 0]
					]
				]
			},
			context
		);
		assert.ok(context.pluginState.dispatch.mock.calls.at(-1).arguments[0].payload.squareMetres > 0);

		// an invalid polygon finished then reopened in edit_vertex reports there too
		adapter.getMode = mock.fn(() => 'edit_vertex');
		handleGeometryChange(
			{
				coordinates: [
					[
						[0, 0],
						[2, 0],
						[2, 2],
						[0, 2],
						[0, 0]
					]
				]
			},
			context
		);
		const payload = context.pluginState.dispatch.mock.calls.at(-1).arguments[0].payload;
		assert.ok(payload.squareMetres > 40_000_000_000);
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

	test('area mode never auto-finishes - its polygon closes with Done', async () => {
		const adapter = fakeDrawAdapter({ getMode: () => 'draw_polygon' });
		const context = fakeContext({ mapProvider: { draw: adapter } });
		context.pluginConfig.pending = { id: 'f1', mode: 'area' };
		// a Polygon's committed feature carries its ring one level deeper than a line's
		handleGeometryChange(
			commitEvent([
				[
					[0, 0],
					[1, 0],
					[1, 1],
					[0, 0]
				]
			]),
			context
		);
		const dispatched = context.pluginState.dispatch.mock.calls.at(-1).arguments[0];
		assert.ok(dispatched.payload.squareMetres > 0);
		await flushEffects();
		assert.equal(adapter.done.mock.calls.length, 0);
	});

	test('editing sessions re-measure on drags and commits for their feature only', () => {
		const adapter = fakeDrawAdapter({ getMode: () => 'edit_vertex' });
		const context = fakeContext({ mapProvider: { draw: adapter } });
		context.pluginConfig.editing = { id: 'f1', mode: 'area', previous: null };

		// mid-drag preview - the model's coordinates are the polygon's [[ring]]
		handleGeometryChange(
			{
				coordinates: [
					[
						[0, 0],
						[1, 0],
						[1, 1],
						[0, 0]
					]
				]
			},
			context
		);
		let payload = context.pluginState.dispatch.mock.calls.at(-1).arguments[0].payload;
		assert.equal(payload.status, 'editing');
		assert.equal(payload.featureId, 'f1');
		assert.ok(payload.squareMetres > 0);

		// a committed vertex move on the same feature refreshes the figure
		handleGeometryChange(
			{
				phase: 'commit-move',
				feature: {
					id: 'f1',
					geometry: {
						type: 'Polygon',
						coordinates: [
							[
								[0, 0],
								[2, 0],
								[2, 2],
								[0, 2],
								[0, 0]
							]
						]
					}
				}
			},
			context
		);
		payload = context.pluginState.dispatch.mock.calls.at(-1).arguments[0].payload;
		assert.ok(payload.squareMetres > 40_000_000_000);

		// commits for a different feature - and a too-small one - are ignored
		const calls = context.pluginState.dispatch.mock.calls.length;
		handleGeometryChange(
			{
				phase: 'commit-move',
				feature: {
					id: 'other',
					geometry: {
						type: 'Polygon',
						coordinates: [
							[
								[0, 0],
								[9, 0],
								[9, 9],
								[0, 0]
							]
						]
					}
				}
			},
			context
		);
		handleGeometryChange(
			{ phase: 'commit-move', feature: { id: 'f1', geometry: { type: 'Polygon', coordinates: [[[0, 0]]] } } },
			context
		);
		assert.equal(context.pluginState.dispatch.mock.calls.length, calls);

		// and a preview in a mode that isn't editing (session ended elsewhere) is ignored
		adapter.getMode = mock.fn(() => 'disabled');
		handleGeometryChange(
			{
				coordinates: [
					[
						[0, 0],
						[9, 0],
						[9, 9],
						[0, 0]
					]
				]
			},
			context
		);
		assert.equal(context.pluginState.dispatch.mock.calls.length, calls);
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
	test('handleDrawCreated ignores other features and unmeasurable shapes', () => {
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

		// ours but a point: pending clears and the shape is still tracked for Clear -
		// it exists on the map even though it measures nothing
		handleDrawCreated({ id: 'f1', geometry: { type: 'Point', coordinates: [-2, 54] } }, context);
		assert.equal(context.pluginConfig.pending, null);
		assert.deepEqual(context.pluginConfig.drawnFeatureIds, ['f1']);
		assert.equal(context.pluginConfig.drawnFeatureModes.f1, 'distance');
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
		// the finished shape is remembered so Clear measurements and click-to-edit find it
		assert.deepEqual(context.pluginConfig.drawnFeatureIds, ['f1']);
		assert.equal(context.pluginConfig.drawnFeatureModes.f1, 'distance');
	});

	test('handleDrawCreated accumulates every finished feature id', () => {
		const context = fakeContext({
			pluginConfig: { modes: ['distance'], pending: null, drawnFeatureIds: ['f0'], drawnFeatureModes: {} }
		});
		context.pluginConfig.pending = { id: 'f1', mode: 'distance' };
		// an id list already on the descriptor is appended to, not replaced
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
		assert.deepEqual(context.pluginConfig.drawnFeatureIds, ['f0', 'f1']);
	});

	test('handleDrawCreated keeps the drawn polygon and reports its area', () => {
		const draw = fakeDrawPlugin();
		const context = fakeContext({ services: fakeServices({ draw }) });
		context.pluginConfig.pending = { id: 'f1', mode: 'area' };
		handleDrawCreated(
			{
				id: 'f1',
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[0, 0],
							[1, 0],
							[1, 1],
							[0, 1],
							[0, 0]
						]
					]
				}
			},
			context
		);

		// the polygon stays exactly as drawn - no swap, nothing deleted or re-added
		assert.equal(draw.deleteFeature.mock.calls.length, 0);
		assert.equal(draw.addFeature.mock.calls.length, 0);

		const payload = context.pluginState.dispatch.mock.calls[0].arguments[0].payload;
		assert.equal(payload.status, 'done');
		assert.equal(payload.featureId, 'f1');
		assert.ok(payload.squareMetres > 12_000_000_000);
		assert.equal(context.pluginConfig.drawnFeatureModes.f1, 'area');

		// a polygon with too few vertices measures nothing
		context.pluginConfig.pending = { id: 'f2', mode: 'area' };
		const calls = context.pluginState.dispatch.mock.calls.length;
		handleDrawCreated(
			{
				id: 'f2',
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[0, 0],
							[1, 0]
						]
					]
				}
			},
			context
		);
		assert.equal(context.pluginState.dispatch.mock.calls.length, calls);
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

	test('handleDrawCancelled restores the pre-edit readout after a cancelled edit', () => {
		const context = fakeContext();
		const previous = { mode: 'area', status: 'done', squareMetres: 123, featureId: 'f1' };
		context.pluginConfig.editing = { id: 'f1', mode: 'area', previous };
		handleDrawCancelled(context);
		assert.equal(context.pluginConfig.editing, null);
		assert.deepEqual(context.pluginState.dispatch.mock.calls[0].arguments[0].payload, previous);

		// an edit with nothing measured before it just resets the panel
		context.pluginConfig.editing = { id: 'f2', mode: 'area', previous: null };
		handleDrawCancelled(context);
		assert.equal(context.pluginState.dispatch.mock.calls.at(-1).arguments[0].payload, null);
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
		// and a new session starting drops any open edit slot - draw runs one at a time
		context.pluginConfig.editing = { id: 'f9', mode: 'area' };
		handleDrawStarted(context);
		assert.equal(context.pluginConfig.editing, null);
	});
});

describe('startEdit and handleDrawEdited', () => {
	const polygonFeature = (
		id,
		ring = [
			[0, 0],
			[1, 0],
			[1, 1],
			[0, 1],
			[0, 0]
		]
	) => ({
		id,
		type: 'Feature',
		geometry: { type: 'Polygon', coordinates: [ring] }
	});

	test('startEdit opens the draw edit session and marks the measurement editing', () => {
		const draw = fakeDrawPlugin();
		const context = fakeContext({ services: fakeServices({ draw }) });
		context.services.hints = { show: mock.fn() };
		context.pluginConfig.drawnFeatureIds = ['f1'];
		context.pluginConfig.drawnFeatureModes = { f1: 'area' };
		context.pluginState.measurement = { mode: 'area', status: 'done', squareMetres: 100, featureId: 'f1' };
		startEdit('f1', context);

		assert.deepEqual(draw.editFeature.mock.calls[0].arguments, ['f1']);
		const payload = context.pluginState.dispatch.mock.calls[0].arguments[0].payload;
		assert.equal(payload.status, 'editing');
		assert.equal(payload.squareMetres, 100); // the previous figure stays up while editing
		assert.equal(payload.featureId, 'f1');
		assert.deepEqual(context.pluginConfig.editing, {
			id: 'f1',
			mode: 'area',
			previous: context.pluginState.measurement
		});
		assert.equal(
			context.services.hints.show.mock.calls[0].arguments[0],
			"Drag the shape's points to change it, then select Done."
		);
		assert.deepEqual(context.services.eventBus.emit.mock.calls[0].arguments, [
			'app:showpanel',
			{ id: 'measure', focus: false }
		]);
	});

	test('startEdit refuses unknown features, busy sessions and failed opens', () => {
		const draw = fakeDrawPlugin();
		const context = fakeContext({ services: fakeServices({ draw }) });
		startEdit('f1'); // no context at all
		startEdit(null, context);
		startEdit('nope', context); // not one of ours
		context.pluginConfig.drawnFeatureIds = ['f1'];
		startEdit('f1', context); // ours but its mode was never recorded
		context.pluginConfig.drawnFeatureModes = { f1: 'area' };
		context.pluginConfig.pending = { id: 'x', mode: 'distance' };
		startEdit('f1', context); // mid-draw
		context.pluginConfig.pending = null;
		context.pluginConfig.editing = { id: 'f2', mode: 'area' };
		startEdit('f1', context); // mid-edit
		context.pluginConfig.editing = null;
		assert.equal(draw.editFeature.mock.calls.length, 0);

		// the draw plugin can also decline the feature
		const failDraw = fakeDrawPlugin({ editFeature: mock.fn(() => false) });
		const failing = fakeContext({ services: fakeServices({ draw: failDraw }) });
		failing.pluginConfig.drawnFeatureIds = ['f1'];
		failing.pluginConfig.drawnFeatureModes = { f1: 'area' };
		startEdit('f1', failing);
		assert.equal(failing.pluginConfig.editing, null);
		assert.equal(failing.pluginState.dispatch.mock.calls.length, 0);
	});

	test('startEdit works when the panel shows a different finished measurement', () => {
		const draw = fakeDrawPlugin();
		const context = fakeContext({ services: fakeServices({ draw }) });
		context.pluginConfig.drawnFeatureIds = ['f1', 'f2'];
		context.pluginConfig.drawnFeatureModes = { f1: 'distance', f2: 'area' };
		context.pluginState.measurement = { mode: 'distance', status: 'done', metres: 5, featureId: 'f1' };
		startEdit('f2', context);
		assert.equal(context.pluginConfig.editing.id, 'f2');
		assert.equal(context.pluginConfig.editing.previous, null);
		const payload = context.pluginState.dispatch.mock.calls[0].arguments[0].payload;
		assert.equal(payload.mode, 'area');
		assert.equal(payload.status, 'editing');
		assert.equal(payload.metres, undefined);
	});

	test('handleDrawEdited re-measures the edited shape and closes the edit', () => {
		const context = fakeContext();
		context.pluginConfig.editing = {
			id: 'f1',
			mode: 'area',
			previous: { mode: 'area', status: 'done', squareMetres: 1, featureId: 'f1' }
		};
		handleDrawEdited(polygonFeature('f1'), context);
		assert.equal(context.pluginConfig.editing, null);
		const payload = context.pluginState.dispatch.mock.calls[0].arguments[0].payload;
		assert.equal(payload.status, 'done');
		assert.equal(payload.featureId, 'f1');
		assert.ok(payload.squareMetres > 12_000_000_000);
	});

	test('handleDrawEdited ignores other features and no-session events, keeps the old figure on a dud', () => {
		const context = fakeContext();
		context.pluginConfig.editing = { id: 'f1', mode: 'area', previous: null };
		handleDrawEdited(polygonFeature('other'), context);
		assert.ok(context.pluginConfig.editing);
		assert.equal(context.pluginState.dispatch.mock.calls.length, 0);
		context.pluginConfig.editing = null;
		handleDrawEdited(polygonFeature('f1'), context);
		assert.equal(context.pluginState.dispatch.mock.calls.length, 0);

		// a shape that no longer measures restores the pre-edit readout
		const previous = { mode: 'area', status: 'done', squareMetres: 7, featureId: 'f1' };
		context.pluginConfig.editing = { id: 'f1', mode: 'area', previous };
		handleDrawEdited({ id: 'f1', geometry: { type: 'Point', coordinates: [0, 0] } }, context);
		assert.deepEqual(context.pluginState.dispatch.mock.calls[0].arguments[0].payload, previous);

		// and with nothing before it, the panel just resets
		context.pluginConfig.editing = { id: 'f1', mode: 'area', previous: null };
		handleDrawEdited({ id: 'f1', geometry: { type: 'Point', coordinates: [0, 0] } }, context);
		assert.equal(context.pluginState.dispatch.mock.calls.at(-1).arguments[0].payload, null);
	});
});

describe('clearMeasurements', () => {
	test('deletes every finished feature in one call and resets the panel', () => {
		const draw = fakeDrawPlugin();
		const context = fakeContext({ services: fakeServices({ draw }) });
		context.pluginConfig.drawnFeatureIds = ['f1', 'f2', 'f3'];
		clearMeasurements(context);
		assert.deepEqual(draw.deleteFeature.mock.calls[0].arguments[0], ['f1', 'f2', 'f3']);
		assert.equal(draw.deleteFeature.mock.calls.length, 1);
		assert.deepEqual(context.pluginConfig.drawnFeatureIds, []);
		assert.deepEqual(context.pluginState.dispatch.mock.calls[0].arguments[0], {
			type: 'SET_MEASUREMENT',
			payload: null
		});
	});

	test('cancels an in-flight session and emits draw:cancelled so listeners stay balanced', () => {
		const eventBus = fakeEventBus();
		const adapter = fakeDrawAdapter();
		const context = fakeContext({
			services: fakeServices({ eventBus }),
			mapProvider: { draw: adapter }
		});
		context.pluginConfig.pending = { id: 'f4', mode: 'path' };
		context.pluginConfig.drawnFeatureIds = ['f1'];
		clearMeasurements(context);
		assert.equal(context.pluginConfig.pending, null);
		assert.equal(adapter.cancel.mock.calls.length, 1);
		assert.deepEqual(eventBus.emit.mock.calls[0].arguments, ['draw:cancelled']);
		// finished shapes go too
		assert.deepEqual(context.pluginConfig.drawnFeatureIds, []);
	});

	test('cancels an open edit session the same way and forgets the recorded modes', () => {
		const eventBus = fakeEventBus();
		const adapter = fakeDrawAdapter();
		const draw = fakeDrawPlugin();
		const context = fakeContext({
			services: fakeServices({ eventBus, draw }),
			mapProvider: { draw: adapter }
		});
		context.pluginConfig.editing = { id: 'f2', mode: 'area', previous: null };
		context.pluginConfig.drawnFeatureIds = ['f1', 'f2'];
		context.pluginConfig.drawnFeatureModes = { f1: 'distance', f2: 'area' };
		clearMeasurements(context);
		assert.equal(context.pluginConfig.editing, null);
		assert.equal(adapter.cancel.mock.calls.length, 1);
		assert.deepEqual(eventBus.emit.mock.calls[0].arguments, ['draw:cancelled']);
		assert.deepEqual(draw.deleteFeature.mock.calls[0].arguments[0], ['f1', 'f2']);
		assert.deepEqual(context.pluginConfig.drawnFeatureModes, {});
	});

	test('with nothing drawn it just resets the panel', () => {
		const draw = fakeDrawPlugin();
		const context = fakeContext({ services: fakeServices({ draw }) });
		clearMeasurements(context);
		assert.equal(draw.deleteFeature.mock.calls.length, 0);
		assert.equal(context.mapProvider.draw.cancel.mock.calls.length, 0);
		assert.equal(context.pluginState.dispatch.mock.calls.length, 1);
	});

	test('tolerates missing services, adapter and context', () => {
		const context = fakeContext({ services: {}, mapProvider: {} });
		context.pluginConfig.pending = { id: 'f1', mode: 'distance' };
		context.pluginConfig.drawnFeatureIds = ['f1'];
		clearMeasurements(context); // nothing to delete through - no throw
		assert.equal(context.pluginConfig.pending, null);
		clearMeasurements();
		clearMeasurements({});
		clearMeasurements(fakeContext({ pluginConfig: {} }));
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

	test('shows the edit hint and the live figure while editing', async () => {
		const container = await renderPanel({
			pluginConfig: {},
			pluginState: { measurement: { mode: 'area', status: 'editing', squareMetres: 500 }, units: {} }
		});
		assert.match(container.textContent, /Drag the shape's points/);
		assert.match(container.textContent, /500 m²/);
		assert.ok(container.querySelector('select'));
		// no Edit button mid-edit - the draw panel's own Done finishes the session
		assert.equal([...container.querySelectorAll('button')].length, 0);
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

	test('Clear removes the measured shape, untracks it and resets the panel', async () => {
		const draw = fakeDrawPlugin();
		const pluginState = { measurement: doneMeasurement, units: {}, dispatch: mock.fn() };
		const pluginConfig = { drawnFeatureIds: ['f0', 'f1'], drawnFeatureModes: { f0: 'distance', f1: 'distance' } };
		const container = await renderPanel({
			pluginConfig,
			pluginState,
			services: fakeServices({ draw })
		});
		const button = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Clear measurement');
		assert.ok(button);
		button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
		await flushEffects();
		assert.deepEqual(draw.deleteFeature.mock.calls[0].arguments[0], ['f1']);
		assert.deepEqual(pluginConfig.drawnFeatureIds, ['f0']);
		assert.deepEqual(pluginConfig.drawnFeatureModes, { f0: 'distance' });
		assert.deepEqual(pluginState.dispatch.mock.calls[0].arguments[0], { type: 'SET_MEASUREMENT', payload: null });
	});

	test('Edit measurement opens the draw edit session for the finished shape', async () => {
		const draw = fakeDrawPlugin();
		const pluginState = { measurement: doneMeasurement, units: {}, dispatch: mock.fn() };
		const pluginConfig = {
			drawnFeatureIds: ['f1'],
			drawnFeatureModes: { f1: 'distance' },
			pending: null,
			editing: null
		};
		const container = await renderPanel({
			pluginConfig,
			pluginState,
			services: fakeServices({ draw })
		});
		const button = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Edit measurement');
		assert.ok(button);
		button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
		await flushEffects();
		assert.deepEqual(draw.editFeature.mock.calls[0].arguments, ['f1']);
		assert.equal(pluginState.dispatch.mock.calls.at(-1).arguments[0].payload.status, 'editing');
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

	test('wires the Clear measurements menu item and cleans up on unmount', async () => {
		const buttonConfig = { 'measure-distance': {}, 'measure-path': {}, 'measure-clear': {} };
		const context = fakeContext();
		context.pluginConfig.drawnFeatureIds = ['f1', 'f2'];
		const container = await renderInit({ ...context, buttonConfig });
		assert.equal(typeof buttonConfig['measure-clear'].onClick, 'function');
		buttonConfig['measure-clear'].onClick(null, {});
		assert.deepEqual(context.pluginConfig.drawnFeatureIds, []);
		const draw = context.services.getPlugin('draw');
		assert.deepEqual(draw.deleteFeature.mock.calls[0].arguments[0], ['f1', 'f2']);
		compat.render(null, container);
		await flushEffects();
		assert.equal(buttonConfig['measure-clear'].onClick, null);
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
		const pluginConfig = {
			modes: ['distance'],
			pending: null,
			editing: null,
			drawnFeatureIds: [],
			drawnFeatureModes: {}
		};
		const pluginState = { measurement: null, units: {}, dispatch: mock.fn() };
		await renderInit({
			pluginConfig,
			pluginState,
			services: fakeServices({ eventBus }),
			mapProvider: { draw: adapter }
		});

		assert.deepEqual(adapter.on.mock.calls[0].arguments[0], 'geometrychange');
		for (const event of ['draw:created', 'draw:cancelled', 'draw:started', 'draw:edited', 'draw:ready']) {
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
		assert.deepEqual(pluginConfig.drawnFeatureIds, ['f1']);
		assert.equal(pluginConfig.drawnFeatureModes.f1, 'distance');

		// a finished edit re-measures through the draw:edited subscription
		pluginConfig.editing = { id: 'f1', mode: 'distance', previous: null };
		eventBus.handlers['draw:edited']({
			id: 'f1',
			geometry: {
				type: 'LineString',
				coordinates: [
					[-2, 54],
					[-1, 55]
				]
			}
		});
		const edited = pluginState.dispatch.mock.calls.at(-1).arguments[0].payload;
		assert.equal(edited.status, 'done');
		assert.equal(edited.featureId, 'f1');
		assert.equal(pluginConfig.editing, null);

		// cancelling a later session reports through the same subscription
		pluginConfig.pending = { id: 'f2', mode: 'path' };
		eventBus.handlers['draw:cancelled']();
		assert.equal(pluginState.dispatch.mock.calls.at(-1).arguments[0].payload.status, 'cancelled');
	});

	test('a click on a finished measurement opens its edit session, and unmount detaches', async () => {
		const eventBus = fakeEventBus();
		const adapter = fakeDrawAdapter();
		const map = fakeMap();
		const pluginConfig = {
			modes: ['distance'],
			pending: null,
			editing: null,
			drawnFeatureIds: ['f1'],
			drawnFeatureModes: { f1: 'distance' }
		};
		const pluginState = {
			measurement: { mode: 'distance', status: 'done', metres: 50, featureId: 'f1' },
			units: {},
			dispatch: mock.fn()
		};
		const container = await renderInit({
			pluginConfig,
			pluginState,
			services: fakeServices({ eventBus }),
			mapProvider: { draw: adapter, map }
		});

		// listeners land on the draw control's inactive fill and outline layers
		const layerIds = map.on.mock.calls.filter((c) => c.arguments[0] === 'click').map((c) => c.arguments[1]);
		assert.deepEqual(layerIds, ['fill-inactive.cold', 'stroke-inactive.cold']);
		const onClick = map.on.mock.calls[0].arguments[2];

		onClick({ features: [{ properties: { id: 'f1' } }] });
		assert.equal(pluginState.dispatch.mock.calls.at(-1).arguments[0].payload.status, 'editing');
		assert.equal(pluginConfig.editing.id, 'f1');

		// clicks that resolve to no feature - or to a shape that isn't ours - do nothing
		onClick({ features: [] });
		onClick({ features: [{ properties: {} }] });
		pluginConfig.editing = null;
		onClick({ features: [{ properties: { id: 'not-ours' } }] });
		assert.equal(pluginConfig.editing, null);
		assert.equal(pluginState.dispatch.mock.calls.length, 1);

		compat.render(null, container);
		await flushEffects();
		const detached = map.off.mock.calls.filter((c) => c.arguments[0] === 'click').map((c) => c.arguments[1]);
		assert.deepEqual(detached, ['fill-inactive.cold', 'stroke-inactive.cold']);
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
