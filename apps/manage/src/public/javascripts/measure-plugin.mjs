/**
 * Measure plugin (spike) for the Defra Interactive Map.
 *
 * Adds a "Measure" toolbar button whose tools draw with the vendor draw plugin rather than
 * reimplementing drawing: every measure mode starts a `newLine` session and reads the shape
 * back, so vertex placement, snapping, keyboard/touch input, the spatial list and the
 * Done/Cancel chrome all come from draw itself. Only the parts draw doesn't cover are added:
 *
 * - `distance` (primary): a line that finishes itself the moment the second vertex lands -
 *   two clicks, one measurement.
 * - `path` (configurable): an open-ended line - the running total updates live as vertices
 *   are added, and the native Done button finishes it.
 * - `area` (configurable): two opposite corners - the second click finishes the line, which
 *   is then swapped for its bounding box on the map; the reported value is the box's area.
 *
 * The live readout rides the draw adapter's `geometrychange` event - the same contract the
 * draw plugin's own validation listens on. Phase-less payloads are the in-progress feature
 * (placed vertices + rubber-band cursor), so the panel updates on every mouse move;
 * `{ phase: 'commit-add', feature }` payloads carry the placed vertices only, which is what
 * triggers the auto-finish for the two-point modes.
 *
 * Usage:
 *
 *   const draw = defra.drawPlugin();
 *   const measure = createMeasurePlugin({ modes: ['distance', 'path', 'area'] });
 *   new defra.InteractiveMap(mapId, { ..., plugins: [draw, measure] });
 *
 * `modes` defaults to ['distance'] - the multi-point path and bounded-box area are opt-in.
 * `units` ('metric' | 'imperial') picks the initial unit in the panel's Units select.
 *
 * The file is `.mjs`, not `.js`: the build fingerprints `javascripts/*.js` (content-hash
 * renames the file), so modules importing this one need a specifier that step leaves alone.
 */

const BUTTON_ID = 'measure';
const PANEL_ID = 'measure';
const BUTTON_ITEM_PREFIX = 'measure-';

// mean earth radius (IUGG) - the same figure turf's distance/area helpers use
const EARTH_RADIUS_METRES = 6371008.8;
const DEG_TO_RAD = Math.PI / 180;

const MEASURE_ICON_SVG =
	'<path d="M2.5 7h19v10h-19z"></path>' + '<path d="M6.5 7v4M10.5 7v6M14.5 7v4M18.5 7v6"></path>';

const MEASURE_LINE_STYLE = { stroke: '#1d70b8', strokeWidth: 3 };
const MEASURE_BOX_STYLE = { stroke: '#1d70b8', strokeWidth: 2, fill: 'rgba(29, 112, 184, 0.15)' };

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
		menuLabel: 'Of a bounded box',
		hint: 'Click two opposite corners of the box.'
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
 * The closed ring of the axis-aligned box with `a` and `b` as opposite corners.
 *
 * @param {number[]} a - [lng, lat]
 * @param {number[]} b - [lng, lat]
 * @returns {number[][]}
 */
export function boundingBoxRing(a, b) {
	const west = Math.min(a[0], b[0]);
	const south = Math.min(a[1], b[1]);
	const east = Math.max(a[0], b[0]);
	const north = Math.max(a[1], b[1]);
	return [
		[west, south],
		[east, south],
		[east, north],
		[west, north],
		[west, south]
	];
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
 * The measurement for a line's vertices under a mode: length for distance/path, the
 * bounding-box area of the first-and-last corners for area. Null until there are at
 * least two points to measure.
 *
 * @param {number[][] | undefined} coordinates
 * @param {string} mode
 * @returns {{ metres: number } | { squareMetres: number } | null}
 */
export function measurementForCoordinates(coordinates, mode) {
	if (!Array.isArray(coordinates) || coordinates.length < 2) {
		return null;
	}
	if (mode === 'area') {
		return { squareMetres: ringAreaSquareMetres(boundingBoxRing(coordinates[0], coordinates[coordinates.length - 1])) };
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
	const id = globalThis.crypto?.randomUUID?.() ?? `measure-${Date.now()}`;
	pluginConfig.pending = { id, mode, expectStart: true, autoFinished: false };
	pluginState?.dispatch?.({ type: 'SET_MEASUREMENT', payload: { mode, status: 'drawing' } });
	services?.eventBus?.emit?.('app:showpanel', { id: PANEL_ID, focus: false });
	services?.hints?.show?.(MODE_META[mode]?.hint);
	draw.newLine(id, MEASURE_LINE_STYLE);
}

/**
 * The draw adapter's live geometry feed. Phase-less payloads are the in-progress feature
 * (coordinates include the rubber-band cursor); `commit-add` payloads carry the placed
 * vertices only, and the second placed vertex auto-finishes the two-point modes.
 *
 * @param {object} event - adapter 'geometrychange' payload
 * @param {object} context
 */
export function handleGeometryChange(event, context) {
	const pending = context?.pluginConfig?.pending;
	if (!pending) {
		return;
	}
	if (event?.phase) {
		if (event.phase !== 'commit-add' || event.feature?.geometry?.type !== 'LineString') {
			return;
		}
		updateLiveMeasurement(event.feature.geometry.coordinates, pending, context, true);
		return;
	}
	if (context?.mapProvider?.draw?.getMode?.() !== 'draw_line' || !Array.isArray(event?.coordinates)) {
		return;
	}
	updateLiveMeasurement(event.coordinates, pending, context, false);
}

function updateLiveMeasurement(coordinates, pending, context, committed) {
	const measurement = measurementForCoordinates(coordinates, pending.mode);
	if (measurement) {
		context.pluginState?.dispatch?.({
			type: 'SET_MEASUREMENT',
			payload: { mode: pending.mode, status: 'drawing', ...measurement }
		});
	}
	if (committed && coordinates.length >= 2 && pending.mode !== 'path' && !pending.autoFinished) {
		pending.autoFinished = true;
		// deferred so the draw mode finishes processing the click that placed the vertex
		setTimeout(() => context.mapProvider?.draw?.done?.(), 0);
	}
}

/**
 * `draw:created` handler: the finished line becomes the final measurement. For `area`
 * the line is the box's diagonal - swap it for the bounding-box polygon on the map so
 * the user sees the shape that was measured.
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
	if (feature?.geometry?.type !== 'LineString') {
		return;
	}
	const measurement = measurementForCoordinates(feature.geometry.coordinates, pending.mode);
	if (!measurement) {
		return;
	}
	if (pending.mode === 'area') {
		const ring = boundingBoxRing(
			feature.geometry.coordinates[0],
			feature.geometry.coordinates[feature.geometry.coordinates.length - 1]
		);
		const draw = context.services?.getPlugin?.('draw');
		draw?.deleteFeature?.([feature.id]);
		draw?.addFeature?.({
			id: feature.id,
			type: 'Feature',
			geometry: { type: 'Polygon', coordinates: [ring] },
			...MEASURE_BOX_STYLE
		});
	}
	context.pluginState?.dispatch?.({
		type: 'SET_MEASUREMENT',
		payload: { mode: pending.mode, status: 'done', ...measurement, featureId: feature.id }
	});
}

/**
 * `draw:cancelled` handler: the session ended with no measurement.
 *
 * @param {object} context
 */
export function handleDrawCancelled(context) {
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
 * `draw:started` handler: the session a measure tool kicked off consumes its expected
 * start; any other start means something else is drawing, so stop listening for ours.
 *
 * @param {object} context
 */
export function handleDrawStarted(context) {
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
			const draw = mapProvider?.draw;
			if (draw?.on) {
				const onGeometryChange = (event) => handleGeometryChange(event, contextRef.current);
				draw.on('geometrychange', onGeometryChange);
				detachDraw = () => draw.off?.('geometrychange', onGeometryChange);
			}
		};
		const onCreated = (feature) => handleDrawCreated(feature, contextRef.current);
		const onCancelled = () => handleDrawCancelled(contextRef.current);
		const onStarted = () => handleDrawStarted(contextRef.current);
		eventBus.on('draw:created', onCreated);
		eventBus.on('draw:cancelled', onCancelled);
		eventBus.on('draw:started', onStarted);
		eventBus.on('draw:ready', attachDraw);
		attachDraw();
		return () => {
			detachDraw();
			eventBus.off('draw:created', onCreated);
			eventBus.off('draw:cancelled', onCancelled);
			eventBus.off('draw:started', onStarted);
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

	if (hasValue && (status === 'drawing' || status === 'done')) {
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
		body.push(
			h(
				'button',
				{
					key: 'clear',
					type: 'button',
					className: 'govuk-button govuk-button--secondary govuk-!-font-size-16 govuk-!-margin-bottom-0',
					onClick: () => {
						if (measurement.featureId) {
							services?.getPlugin?.('draw')?.deleteFeature?.([measurement.featureId]);
						}
						pluginState?.dispatch?.({ type: 'SET_MEASUREMENT', payload: null });
					}
				},
				'Clear measurement'
			)
		);
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
 * per mode, otherwise it's an action button wired straight to that mode (MeasureInit
 * attaches the onClick through buttonConfig either way).
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
							menuItems: modes.map((mode) => ({
								id: `${BUTTON_ITEM_PREFIX}${mode}`,
								label: MODE_META[mode].menuLabel
							}))
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
 *   'path' adds multi-point distance and 'area' the two-corner bounded box.
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
		// the in-flight session ({ id, mode, expectStart, autoFinished }) lives on the
		// descriptor - like the layers-key plugin's checkedCache, it survives panel remounts
		pending: null,
		load: async () => buildManifest(modes)
	};
}
