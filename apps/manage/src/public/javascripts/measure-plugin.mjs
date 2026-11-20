/**
 * Measure plugin (spike) for the Defra Interactive Map.
 *
 * Adds a "Measure" toolbar button whose tools draw with the vendor draw plugin rather than
 * reimplementing drawing: line modes start a `newLine` session, the area mode starts a
 * `newPolygon` session, and finished shapes re-open through `editFeature` - so vertex
 * placement, snapping (the draw menu's Snap to feature toggle, enabled via the draw
 * plugin's snapLayers), keyboard/touch input, the spatial list and the Done/Cancel chrome
 * all come from draw itself. Only the parts draw doesn't cover are added:
 *
 * - `distance` (primary): a line that finishes itself the moment the second vertex lands -
 *   two clicks, one measurement.
 * - `path` (configurable): an open-ended line - the running total updates live as vertices
 *   are added, and the native Done button finishes it.
 * - `area` (configurable): a polygon drawn corner by corner - vertex handles while
 *   drawing, self-intersection and area validation built in, Done finishes it.
 *
 * A finished measurement stays on the map: clicking it (or the panel's Edit button)
 * opens the draw plugin's edit session - drag, insert or delete vertices, Snap toggle
 * included - and `draw:edited` hands the re-measured shape back. Cancelling an edit
 * restores both the shape and the readout.
 *
 * The live readout rides the draw adapter's `geometrychange` event - the same contract the
 * draw plugin's own validation listens on. Phase-less payloads are the in-progress feature
 * (placed vertices + rubber-band cursor during draw, the dragged feature during edit), so
 * the panel updates on every mouse move; `commit-*` payloads carry placed/moved vertices,
 * which is what triggers the auto-finish for the two-point mode and the refresh mid-edit.
 *
 * Usage:
 *
 *   const draw = defra.drawPlugin({ snapLayers: ['consultee-areas-identified-0'] });
 *   const measure = createMeasurePlugin({ modes: ['distance', 'path', 'area'] });
 *   new defra.InteractiveMap(mapId, { ..., plugins: [draw, measure] });
 *
 * `modes` defaults to ['distance'] - the multi-point path and polygon area are opt-in.
 * `units` ('metric' | 'imperial') picks the initial unit in the panel's Units select.
 *
 * With more than one mode the button is a menu; a "Clear measurements" item is appended to
 * it. Every finished measurement's feature id is kept on pluginConfig.drawnFeatureIds (the
 * same descriptor-level slot `pending`/`editing` use), so the item can delete all of them -
 * a finished shape no longer has to be the latest one to be removable.
 *
 * The file is `.mjs`, not `.js`: the build fingerprints `javascripts/*.js` (content-hash
 * renames the file), so modules importing this one need a specifier that step leaves alone.
 */

const BUTTON_ID = 'measure';
const PANEL_ID = 'measure';
const BUTTON_ITEM_PREFIX = 'measure-';
const CLEAR_ITEM_ID = 'measure-clear';

// the draw control renders finished (inactive) features on these layers - mapbox-gl-draw
// appends .cold/.hot to the ids its styles declare (styles.js), so a click on an inactive
// fill or outline is a request to edit that shape
const INACTIVE_DRAW_LAYERS = ['fill-inactive.cold', 'stroke-inactive.cold'];

const EDIT_HINT = "Drag the shape's points to change it, then select Done.";

// mean earth radius (IUGG) - the same figure turf's distance/area helpers use
const EARTH_RADIUS_METRES = 6371008.8;
const DEG_TO_RAD = Math.PI / 180;

const MEASURE_ICON_SVG =
	'<path d="M2.5 7h19v10h-19z"></path>' + '<path d="M6.5 7v4M10.5 7v6M14.5 7v4M18.5 7v6"></path>';

const MEASURE_LINE_STYLE = { stroke: '#1d70b8', strokeWidth: 3 };
const MEASURE_POLYGON_STYLE = { stroke: '#1d70b8', strokeWidth: 2, fill: 'rgba(29, 112, 184, 0.15)' };

export const MEASURE_MODES = ['distance', 'path', 'area'];

export const MODE_META = {
	distance: {
		menuLabel: 'Between two points',
		hint: 'Click two points on the map to measure the distance between them.'
	},
	path: {
		menuLabel: 'Along a path',
		hint: 'Click each point on the path, then select Done.'
	},
	area: {
		menuLabel: 'Of an area',
		hint: 'Click each corner of the area, then select Done.'
	}
};

export const DISTANCE_UNITS = [
	{ id: 'm', label: 'metres', suffix: 'm', convert: (metres) => metres },
	{ id: 'km', label: 'kilometres', suffix: 'km', convert: (metres) => metres / 1000 },
	{ id: 'ft', label: 'feet', suffix: 'ft', convert: (metres) => metres * 3.28084 },
	{ id: 'mi', label: 'miles', suffix: 'mi', convert: (metres) => metres / 1609.344 }
];

export const AREA_UNITS = [
	{ id: 'm2', label: 'square metres', suffix: 'm²', convert: (squareMetres) => squareMetres },
	{ id: 'km2', label: 'square kilometres', suffix: 'km²', convert: (squareMetres) => squareMetres / 1e6 },
	{ id: 'ft2', label: 'square feet', suffix: 'ft²', convert: (squareMetres) => squareMetres * 10.7639104 },
	{ id: 'mi2', label: 'square miles', suffix: 'mi²', convert: (squareMetres) => squareMetres / 2589988.110336 }
];

/**
 * The unit shown before the user picks one: metres for `units: 'metric'`, feet for
 * `units: 'imperial'` (and any unrecognised value falls back to metric).
 *
 * @param {string | undefined} unitsOption - the plugin's `units` option
 * @param {'distance' | 'area'} kind
 * @returns {string} a unit id from DISTANCE_UNITS / AREA_UNITS
 */
export function defaultUnitId(unitsOption, kind) {
	if (unitsOption === 'imperial') {
		return kind === 'area' ? 'ft2' : 'ft';
	}
	return kind === 'area' ? 'm2' : 'm';
}

function formatNumber(value) {
	const maximumFractionDigits = value >= 1000 ? 0 : value >= 1 ? 2 : 3;
	return value.toLocaleString('en-GB', { maximumFractionDigits });
}

/**
 * A measurement object ({ metres } or { squareMetres }) formatted in the requested unit,
 * e.g. '1.24 km' or '5.2 m²'. Unknown unit ids fall back to the kind's base unit.
 *
 * @param {object | null | undefined} measurement
 * @param {string} unitId
 * @returns {string}
 */
export function formatMeasurement(measurement, unitId) {
	if (!measurement) {
		return '';
	}
	const isArea = measurement.squareMetres != null;
	const units = isArea ? AREA_UNITS : DISTANCE_UNITS;
	const unit = units.find((candidate) => candidate.id === unitId) ?? units[0];
	const value = unit.convert(isArea ? measurement.squareMetres : (measurement.metres ?? 0));
	return `${formatNumber(value)} ${unit.suffix}`;
}

/**
 * @param {number[]} a - [lng, lat]
 * @param {number[]} b - [lng, lat]
 * @returns {number} great-circle distance in metres
 */
export function haversineMetres(a, b) {
	const lat1 = a[1] * DEG_TO_RAD;
	const lat2 = b[1] * DEG_TO_RAD;
	const dLat = lat2 - lat1;
	const dLng = (b[0] - a[0]) * DEG_TO_RAD;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * @param {number[][]} [coordinates] - line vertices as [lng, lat]
 * @returns {number} total line length in metres
 */
export function lineLengthMetres(coordinates = []) {
	let total = 0;
	for (let i = 1; i < coordinates.length; i++) {
		total += haversineMetres(coordinates[i - 1], coordinates[i]);
	}
	return total;
}

/**
 * Geodesic area of a polygon ring in square metres - the same spherical algorithm
 * geojson-area and mapbox-gl-draw's own readouts use.
 *
 * @param {number[][]} [ring] - closed ring of [lng, lat] vertices
 * @returns {number}
 */
export function ringAreaSquareMetres(ring = []) {
	let total = 0;
	for (let i = 1; i < ring.length; i++) {
		const [lng1, lat1] = ring[i - 1];
		const [lng2, lat2] = ring[i];
		total += (lng2 - lng1) * DEG_TO_RAD * (2 + Math.sin(lat1 * DEG_TO_RAD) + Math.sin(lat2 * DEG_TO_RAD));
	}
	return Math.abs((total * EARTH_RADIUS_METRES * EARTH_RADIUS_METRES) / 2);
}

/**
 * The measurement for a feature's coordinates under a mode: length for distance/path
 * (flat [lng, lat] list), the outer ring's area for area (a Polygon's
 * coordinates - `[[ring]]`). Null until the shape has enough points to measure.
 *
 * @param {number[][] | number[][][] | undefined} coordinates
 * @param {string} mode
 * @returns {{ metres: number } | { squareMetres: number } | null}
 */
export function measurementForCoordinates(coordinates, mode) {
	if (!Array.isArray(coordinates)) {
		return null;
	}
	if (mode === 'area') {
		const ring = coordinates[0];
		if (!Array.isArray(ring) || ring.length < 3) {
			return null;
		}
		return { squareMetres: ringAreaSquareMetres(ring) };
	}
	if (coordinates.length < 2 || !Array.isArray(coordinates[0])) {
		return null;
	}
	return { metres: lineLengthMetres(coordinates) };
}

/**
 * Start a measure session. Wired to the manifest button/menu items through the plugin's
 * buttonConfig (see MeasureInit), so it runs with the component's PluginContext.
 *
 * @param {string} mode
 * @param {object} context - PluginContext ({ pluginConfig, pluginState, services, mapProvider })
 */
export function startMeasure(mode, context) {
	const { pluginConfig, pluginState, services, mapProvider } = context ?? {};
	const draw = services?.getPlugin?.('draw');
	if (!draw?.newLine || !mapProvider?.draw || !pluginConfig) {
		pluginState?.dispatch?.({ type: 'SET_MEASUREMENT', payload: { mode, status: 'unavailable' } });
		services?.eventBus?.emit?.('app:showpanel', { id: PANEL_ID, focus: false });
		return;
	}
	// a tool picked mid-edit: commit the edit first so the sessions never overlap
	if (pluginConfig.editing) {
		mapProvider.draw.done?.();
		pluginConfig.editing = null;
	}
	const id = globalThis.crypto?.randomUUID?.() ?? `measure-${Date.now()}`;
	pluginConfig.pending = { id, mode, expectStart: true, autoFinished: false };
	pluginState?.dispatch?.({ type: 'SET_MEASUREMENT', payload: { mode, status: 'drawing' } });
	services?.eventBus?.emit?.('app:showpanel', { id: PANEL_ID, focus: false });
	services?.hints?.show?.(MODE_META[mode]?.hint);
	if (mode === 'area') {
		draw.newPolygon?.(id, MEASURE_POLYGON_STYLE);
	} else {
		draw.newLine(id, MEASURE_LINE_STYLE);
	}
}

/**
 * The draw adapter's live geometry feed. Phase-less payloads are the in-progress feature
 * (coordinates include the rubber-band cursor while drawing, the dragged shape while
 * editing); `commit-*` payloads carry the feature after a vertex op - `commit-add` while
 * drawing triggers the distance mode's auto-finish, every commit while editing refreshes
 * the readout.
 *
 * @param {object} event - adapter 'geometrychange' payload
 * @param {object} context
 */
export function handleGeometryChange(event, context) {
	const pluginConfig = context?.pluginConfig;
	const pending = pluginConfig?.pending;
	const editing = pluginConfig?.editing;
	if (!pending && !editing) {
		return;
	}
	if (event?.phase) {
		const feature = event.feature;
		const coordinates = feature?.geometry?.coordinates;
		if (!Array.isArray(coordinates)) {
			return;
		}
		if (editing && feature.id === editing.id) {
			updateEditedMeasurement(coordinates, editing, context);
			return;
		}
		if (pending) {
			// commit-add in the draw mode auto-finishes the two-point mode; commits in
			// edit_vertex are an invalid create being fixed - refresh only, the draw
			// control's own Done decides when that ends
			const autoFinished = event.phase === 'commit-add' && context?.mapProvider?.draw?.getMode?.() === 'draw_line';
			updateLiveMeasurement(coordinates, pending, context, autoFinished);
		}
		return;
	}
	if (!Array.isArray(event?.coordinates)) {
		return;
	}
	const drawMode = context?.mapProvider?.draw?.getMode?.();
	if (editing && (drawMode === 'edit_vertex' || drawMode === 'edit_point')) {
		updateEditedMeasurement(event.coordinates, editing, context);
		return;
	}
	// the adapter's own sketch shape for this session's mode - or its reopened-for-fixes
	// edit when an invalid create gets handed back to the user (edit_vertex while pending)
	const expected = pending?.mode === 'area' ? 'draw_polygon' : 'draw_line';
	if (pending && (drawMode === expected || drawMode === 'edit_vertex')) {
		updateLiveMeasurement(event.coordinates, pending, context, false);
	}
}

function updateLiveMeasurement(coordinates, pending, context, committed) {
	const measurement = measurementForCoordinates(coordinates, pending.mode);
	if (measurement) {
		context.pluginState?.dispatch?.({
			type: 'SET_MEASUREMENT',
			payload: { mode: pending.mode, status: 'drawing', ...measurement }
		});
	}
	if (committed && coordinates.length >= 2 && pending.mode === 'distance' && !pending.autoFinished) {
		pending.autoFinished = true;
		// deferred so the draw mode finishes processing the click that placed the vertex
		setTimeout(() => context.mapProvider?.draw?.done?.(), 0);
	}
}

function updateEditedMeasurement(coordinates, editing, context) {
	const measurement = measurementForCoordinates(coordinates, editing.mode);
	if (measurement) {
		context.pluginState?.dispatch?.({
			type: 'SET_MEASUREMENT',
			payload: { mode: editing.mode, status: 'editing', ...measurement, featureId: editing.id }
		});
	}
}

/**
 * `draw:created` handler: the finished shape becomes the final measurement - the line's
 * length, or the polygon's area for `area` sessions (draw_polygon produces the shape
 * directly; no post-processing needed). Also fires for a shape that finished invalid,
 * was reopened in edit mode and got fixed - still ours.
 *
 * @param {object} feature - the finished GeoJSON feature
 * @param {object} context
 */
export function handleDrawCreated(feature, context) {
	const pending = context?.pluginConfig?.pending;
	if (!pending || feature?.id !== pending.id) {
		return;
	}
	context.pluginConfig.pending = null;
	// ours - the drawn feature stays on the map, so remember its id (and which tool drew
	// it) for Clear measurements and click-to-edit
	(context.pluginConfig.drawnFeatureIds ??= []).push(feature.id);
	(context.pluginConfig.drawnFeatureModes ??= {})[feature.id] = pending.mode;
	const measurement = measurementForCoordinates(feature.geometry?.coordinates, pending.mode);
	if (!measurement) {
		return;
	}
	context.pluginState?.dispatch?.({
		type: 'SET_MEASUREMENT',
		payload: { mode: pending.mode, status: 'done', ...measurement, featureId: feature.id }
	});
}

/**
 * `draw:cancelled` handler: a draw session ends with no measurement; an edit session
 * restores the pre-edit shape - restore the pre-edit readout the same way.
 *
 * @param {object} context
 */
export function handleDrawCancelled(context) {
	const editing = context?.pluginConfig?.editing;
	if (editing) {
		context.pluginConfig.editing = null;
		context.pluginState?.dispatch?.({ type: 'SET_MEASUREMENT', payload: editing.previous ?? null });
		return;
	}
	const pending = context?.pluginConfig?.pending;
	if (!pending) {
		return;
	}
	context.pluginConfig.pending = null;
	context.pluginState?.dispatch?.({
		type: 'SET_MEASUREMENT',
		payload: { mode: pending.mode, status: 'cancelled' }
	});
}

/**
 * `draw:edited` handler: the edit session's finished shape is the new measurement -
 * re-measure and close the edit slot.
 *
 * @param {object} feature - the edited GeoJSON feature
 * @param {object} context
 */
export function handleDrawEdited(feature, context) {
	const editing = context?.pluginConfig?.editing;
	if (!editing || feature?.id !== editing.id) {
		return;
	}
	context.pluginConfig.editing = null;
	const measurement = measurementForCoordinates(feature.geometry?.coordinates, editing.mode);
	context.pluginState?.dispatch?.({
		type: 'SET_MEASUREMENT',
		payload: measurement
			? { mode: editing.mode, status: 'done', ...measurement, featureId: feature.id }
			: (editing.previous ?? null)
	});
}

/**
 * `draw:started` handler: the session a measure tool kicked off consumes its expected
 * start; any other start means something else is drawing, so stop listening for ours -
 * and drop any edit slot, the draw control only runs one session at a time.
 *
 * @param {object} context
 */
export function handleDrawStarted(context) {
	context?.pluginConfig && (context.pluginConfig.editing = null);
	const pending = context?.pluginConfig?.pending;
	if (!pending) {
		return;
	}
	if (pending.expectStart) {
		pending.expectStart = false;
		return;
	}
	context.pluginConfig.pending = null;
}

/**
 * Open a finished measurement's shape for editing - clicking it on the map (the inactive
 * draw layers) or the panel's Edit button lands here. The draw plugin's edit session
 * gives the shape the same vertex handles, Snap toggle and Done/Cancel chrome a draw
 * session has; `draw:edited` hands the re-measured feature back, `draw:cancelled`
 * restores it.
 *
 * @param {string} featureId - a drawnFeatureIds member
 * @param {object} context - PluginContext ({ pluginConfig, pluginState, services })
 */
export function startEdit(featureId, context) {
	const id = featureId == null ? null : String(featureId);
	const { pluginConfig, pluginState, services } = context ?? {};
	if (!id || pluginConfig?.pending || pluginConfig?.editing) {
		return;
	}
	if (!pluginConfig?.drawnFeatureIds?.includes(id)) {
		return;
	}
	const mode = pluginConfig?.drawnFeatureModes?.[id];
	if (!mode || !services?.getPlugin?.('draw')?.editFeature?.(id)) {
		return;
	}
	const measurement = pluginState?.measurement;
	const current = measurement?.featureId === id ? measurement : null;
	pluginConfig.editing = { id, mode, previous: current };
	pluginState?.dispatch?.({
		type: 'SET_MEASUREMENT',
		payload: { ...(current ?? {}), mode, status: 'editing', featureId: id }
	});
	services?.hints?.show?.(EDIT_HINT);
	services?.eventBus?.emit?.('app:showpanel', { id: PANEL_ID, focus: false });
}

/**
 * "Clear measurements" menu action: removes every shape a measure session finished,
 * abandons one still being drawn or edited, and resets the panel. The adapter's
 * cancel() trashes the in-progress feature but doesn't emit draw:cancelled (the draw
 * panel's own Cancel button does that itself) - emit it here so listeners that suspend
 * on draw:started, like the consultees map's interact plugin, are re-enabled.
 *
 * @param {object} context - PluginContext ({ pluginConfig, pluginState, services, mapProvider })
 */
export function clearMeasurements(context) {
	const { pluginConfig, pluginState, services, mapProvider } = context ?? {};
	if (pluginConfig?.editing || pluginConfig?.pending) {
		pluginConfig.editing = null;
		pluginConfig.pending = null;
		mapProvider?.draw?.cancel?.();
		services?.eventBus?.emit?.('draw:cancelled');
	}
	const ids = pluginConfig?.drawnFeatureIds;
	if (ids?.length) {
		services?.getPlugin?.('draw')?.deleteFeature?.(ids);
		pluginConfig.drawnFeatureIds = [];
		pluginConfig.drawnFeatureModes = {};
	}
	pluginState?.dispatch?.({ type: 'SET_MEASUREMENT', payload: null });
}

const initialState = { measurement: null, units: {} };

const actions = {
	SET_MEASUREMENT: (state, payload) => ({ ...state, measurement: payload }),
	SET_UNIT: (state, payload) => ({ ...state, units: { ...state.units, [payload.kind]: payload.unit } })
};

/**
 * Plugin init: wires the manifest button/menu items to startMeasure via the live
 * buttonConfig (the draw plugin's own pattern for buttons it can't hard-code in the
 * manifest), subscribes to the draw events on the shared event bus, and attaches to
 * the draw adapter's geometrychange feed once `draw:ready` reports it mounted.
 */
export function MeasureInit({ pluginConfig, pluginState, services, mapProvider, buttonConfig }) {
	const { useEffect, useRef } = globalThis.preactCompat;
	const contextRef = useRef(null);
	contextRef.current = { pluginConfig, pluginState, services, mapProvider };

	useEffect(() => {
		const modes = pluginConfig?.modes?.length ? pluginConfig.modes : ['distance'];
		// the menu's activate context has no pluginId, so it lacks pluginConfig/pluginState -
		// always run with the InitComponent's own injected context (fresh via contextRef)
		const wire = (mode) => () => startMeasure(mode, contextRef.current);
		for (const mode of modes) {
			const item = buttonConfig?.[`${BUTTON_ITEM_PREFIX}${mode}`];
			if (item) {
				item.onClick = wire(mode);
			}
		}
		// a single configured mode renders the button itself, not a menu - wire it too
		if (modes.length === 1 && buttonConfig?.[BUTTON_ID]) {
			buttonConfig[BUTTON_ID].onClick = wire(modes[0]);
		}
		// the menu's trailing Clear item removes every measured shape at once
		const clearItem = buttonConfig?.[CLEAR_ITEM_ID];
		if (clearItem) {
			clearItem.onClick = () => clearMeasurements(contextRef.current);
		}
		return () => {
			for (const mode of modes) {
				const item = buttonConfig?.[`${BUTTON_ITEM_PREFIX}${mode}`];
				if (item) {
					item.onClick = null;
				}
			}
			if (buttonConfig?.[BUTTON_ID]) {
				buttonConfig[BUTTON_ID].onClick = null;
			}
			if (clearItem) {
				clearItem.onClick = null;
			}
		};
	}, [buttonConfig]);

	useEffect(() => {
		const { eventBus } = services ?? {};
		if (!eventBus) {
			return undefined;
		}
		let detachDraw = () => {};
		const attachDraw = () => {
			detachDraw();
			const detachers = [];
			const draw = mapProvider?.draw;
			if (draw?.on) {
				const onGeometryChange = (event) => handleGeometryChange(event, contextRef.current);
				draw.on('geometrychange', onGeometryChange);
				detachers.push(() => draw.off?.('geometrychange', onGeometryChange));
			}
			// clicking a finished measurement on the map opens its edit session - the
			// inactive draw layers only exist once the adapter does, so same condition
			const map = mapProvider?.map;
			if (draw?.on && map?.on) {
				const onShapeClick = (event) => {
					const id = event?.features?.[0]?.properties?.id;
					if (id != null) {
						startEdit(id, contextRef.current);
					}
				};
				for (const layerId of INACTIVE_DRAW_LAYERS) {
					map.on('click', layerId, onShapeClick);
				}
				detachers.push(() => {
					for (const layerId of INACTIVE_DRAW_LAYERS) {
						map.off?.('click', layerId, onShapeClick);
					}
				});
			}
			detachDraw = () => detachers.forEach((detach) => detach());
		};
		const onCreated = (feature) => handleDrawCreated(feature, contextRef.current);
		const onCancelled = () => handleDrawCancelled(contextRef.current);
		const onStarted = () => handleDrawStarted(contextRef.current);
		const onEdited = (feature) => handleDrawEdited(feature, contextRef.current);
		eventBus.on('draw:created', onCreated);
		eventBus.on('draw:cancelled', onCancelled);
		eventBus.on('draw:started', onStarted);
		eventBus.on('draw:edited', onEdited);
		eventBus.on('draw:ready', attachDraw);
		attachDraw();
		return () => {
			detachDraw();
			eventBus.off('draw:created', onCreated);
			eventBus.off('draw:cancelled', onCancelled);
			eventBus.off('draw:started', onStarted);
			eventBus.off('draw:edited', onEdited);
			eventBus.off('draw:ready', attachDraw);
		};
	}, [services, mapProvider]);

	return null;
}

/**
 * The panel body: the current hint or result, a Units select once there's a number to
 * show, and Clear to remove the measured shape. Rendered by the component's slot system;
 * `aria-live` on the result announces updates to screen readers mid-draw.
 */
export function MeasurePanel({ appConfig, pluginConfig, pluginState, services }) {
	const { createElement: h } = globalThis.preactCompat;
	const measurement = pluginState?.measurement;
	const hasValue = measurement?.metres != null || measurement?.squareMetres != null;
	const kind = measurement?.squareMetres != null ? 'area' : 'distance';
	const unitOptions = kind === 'area' ? AREA_UNITS : DISTANCE_UNITS;
	const currentUnit = pluginState?.units?.[kind] ?? defaultUnitId(pluginConfig?.units, kind);
	const selectId = `${appConfig?.id ?? 'map'}-measure-units`;
	const status = measurement?.status;

	const body = [];
	if (!measurement) {
		body.push(
			h('p', { key: 'intro', className: 'govuk-body-s' }, 'Choose a measure tool from the Measure button to start.')
		);
	} else if (status === 'drawing') {
		body.push(
			h('p', { key: 'hint', className: 'govuk-body-s' }, MODE_META[measurement.mode]?.hint ?? 'Draw on the map.')
		);
	} else if (status === 'editing') {
		body.push(h('p', { key: 'hint', className: 'govuk-body-s' }, EDIT_HINT));
	} else if (status === 'cancelled') {
		body.push(h('p', { key: 'cancelled', className: 'govuk-body-s' }, 'Measurement cancelled.'));
	} else if (status === 'unavailable') {
		body.push(
			h(
				'p',
				{ key: 'unavailable', className: 'govuk-body-s' },
				'Measure tools are not available - try again when the map has loaded.'
			)
		);
	}

	if (hasValue && status !== 'cancelled' && status !== 'unavailable') {
		body.push(
			h(
				'p',
				{
					key: 'result',
					className: 'govuk-heading-s govuk-!-margin-bottom-2 app-measure-result',
					'aria-live': 'polite'
				},
				formatMeasurement(measurement, currentUnit)
			)
		);
	}

	if (hasValue && (status === 'drawing' || status === 'editing' || status === 'done')) {
		body.push(
			h('div', { key: 'units', className: 'govuk-form-group govuk-!-margin-bottom-2' }, [
				h('label', { key: 'label', className: 'govuk-label govuk-!-font-size-16', htmlFor: selectId }, 'Units'),
				h(
					'select',
					{
						key: 'select',
						className: 'govuk-select govuk-!-font-size-16',
						id: selectId,
						name: 'measure-units',
						value: currentUnit,
						onChange: (event) =>
							pluginState?.dispatch?.({ type: 'SET_UNIT', payload: { kind, unit: event?.target?.value } })
					},
					unitOptions.map((unit) => h('option', { key: unit.id, value: unit.id }, `${unit.label} (${unit.suffix})`))
				)
			])
		);
	}

	if (status === 'done') {
		const actions = [];
		if (measurement.featureId) {
			actions.push(
				h(
					'button',
					{
						key: 'edit',
						type: 'button',
						className: 'govuk-button govuk-button--secondary govuk-!-font-size-16',
						onClick: () => startEdit(measurement.featureId, { pluginConfig, pluginState, services })
					},
					'Edit measurement'
				)
			);
		}
		actions.push(
			h(
				'button',
				{
					key: 'clear',
					type: 'button',
					className: 'govuk-button govuk-button--secondary govuk-!-font-size-16 govuk-!-margin-bottom-0',
					onClick: () => {
						if (measurement.featureId) {
							services?.getPlugin?.('draw')?.deleteFeature?.([measurement.featureId]);
							const ids = pluginConfig?.drawnFeatureIds;
							if (ids) {
								pluginConfig.drawnFeatureIds = ids.filter((id) => id !== measurement.featureId);
							}
							if (pluginConfig?.drawnFeatureModes) {
								delete pluginConfig.drawnFeatureModes[measurement.featureId];
							}
						}
						pluginState?.dispatch?.({ type: 'SET_MEASUREMENT', payload: null });
					}
				},
				'Clear measurement'
			)
		);
		// the group spaces the buttons whether they sit side by side or wrap
		// (stacked in the narrow panel they otherwise collapse into one block)
		body.push(h('div', { key: 'actions', className: 'govuk-button-group govuk-!-margin-bottom-0' }, actions));
	}

	return h('div', { className: 'app-measure-panel' }, body);
}

/**
 * Guard for the manifest's render entry: if the map bundle has not exposed preactCompat
 * (e.g. an unexpected ESM build), the panel opens empty rather than crashing the map.
 */
function MeasurePanelShell(props) {
	const compat = globalThis.preactCompat;
	return compat?.createElement ? compat.createElement(MeasurePanel, props) : null;
}

/**
 * One Measure button; with more than one configured mode it opens a menu with an item
 * per mode plus a Clear measurements item, otherwise it's an action button wired straight
 * to that mode (MeasureInit attaches the onClick through buttonConfig either way).
 */
function buildManifest(modes) {
	return {
		reducer: { initialState, actions },
		InitComponent: MeasureInit,
		icons: [{ id: 'app-measure', svgContent: MEASURE_ICON_SVG }],
		buttons: [
			{
				id: BUTTON_ID,
				label: ({ pluginConfig }) => pluginConfig?.buttonLabel ?? 'Measure',
				iconId: 'app-measure',
				...(modes.length > 1
					? {
							menuItems: [
								...modes.map((mode) => ({
									id: `${BUTTON_ITEM_PREFIX}${mode}`,
									label: MODE_META[mode].menuLabel
								})),
								{ id: CLEAR_ITEM_ID, label: 'Clear measurements' }
							]
						}
					: {}),
				mobile: { slot: 'top-left', showLabel: true },
				tablet: { slot: 'top-left', showLabel: true },
				desktop: { slot: 'top-left', showLabel: true }
			}
		],
		panels: [
			{
				id: PANEL_ID,
				label: ({ pluginConfig }) => pluginConfig?.panelLabel ?? 'Measure',
				focus: false,
				mobile: { slot: 'drawer', dismissible: true },
				tablet: { slot: 'left-top', dismissible: true, exclusive: true, width: '300px' },
				desktop: { slot: 'left-top', dismissible: true, exclusive: true, width: '300px' },
				render: MeasurePanelShell
			}
		]
	};
}

/**
 * @param {object} [options]
 * @param {string[]} [options.modes] - subset of 'distance' | 'path' | 'area' to offer.
 *   'distance' (2-point line) is the primary tool and the default when none are given;
 *   'path' adds multi-point distance and 'area' polygon area.
 * @param {'metric' | 'imperial'} [options.units] - initial unit for the panel's select
 * @param {string} [options.buttonLabel] - toolbar button text (default 'Measure')
 * @param {string} [options.panelLabel] - panel heading (default 'Measure')
 * @returns {object} PluginDescriptor for InteractiveMap's `plugins` option
 */
export function createMeasurePlugin(options = {}) {
	const requested = (Array.isArray(options.modes) && options.modes.length ? options.modes : ['distance']).filter(
		(mode) => MEASURE_MODES.includes(mode)
	);
	const modes = [...new Set(requested.length ? requested : ['distance'])];

	return {
		id: 'measure',
		modes,
		units: options.units === 'imperial' ? 'imperial' : 'metric',
		buttonLabel: options.buttonLabel,
		panelLabel: options.panelLabel,
		// the in-flight sessions ({ id, mode, expectStart, autoFinished } for drawing,
		// { id, mode, previous } for editing) live on the descriptor - like the
		// layers-key plugin's checkedCache, they survive panel remounts
		pending: null,
		editing: null,
		// ids of every finished measurement's drawn feature, for Clear measurements, and
		// the mode each was drawn with, for click-to-edit re-measurement
		drawnFeatureIds: [],
		drawnFeatureModes: {},
		load: async () => buildManifest(modes)
	};
}
