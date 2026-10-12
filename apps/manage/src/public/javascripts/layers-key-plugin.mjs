/**
 * Combined "Layers" panel plugin for the Defra Interactive Map.
 *
 * The datasets plugin ships two separate panels - "Layers" (visibility checkboxes) and "Key"
 * (symbol legend, via the separate map-key plugin). This plugin folds them into one panel:
 * each toggle row shows the layer's key symbol between the checkbox and its label, so the
 * symbol and its on/off control sit together.
 *
 * Usage mirrors the built-in plugins:
 *
 *   const datasetsPlugin = defra.datasetsPlugin({ datasets, hasMenu: false });
 *   const layersKeyPlugin = createLayersKeyPlugin({ datasets });
 *   new defra.InteractiveMap(mapId, { ..., plugins: [datasetsPlugin, layersKeyPlugin] });
 *
 * `hasMenu: false` keeps the datasets plugin's own Layers button and panel hidden while it
 * still renders the layers; don't register mapKeyPlugin alongside this one - this panel
 * replaces it. Pass the same `datasets` array to both plugins: `showInMenu`, `groupLabel`
 * and `sublayers` drive this panel's rows exactly as they drive the built-in menu.
 *
 * The file is `.mjs`, not `.js`: the build fingerprints `javascripts/*.js` (content-hash
 * renames the file), so modules importing this one need a specifier that step leaves alone.
 *
 * Internals rely on the component's plugin surface: manifest buttons/panels,
 * `services.getPlugin('datasets')` for `setDatasetVisibility`, `services.eventBus` for
 * `datasets:registry` / `datasets:changed`, and `services.symbolRegistry` /
 * `services.patternRegistry` for the key symbols. `window.preactCompat` (exposed by the
 * map's UMD bundle for plugin authors) supplies createElement and the hooks - plain JS,
 * no JSX or build step.
 */

const BUTTON_ID = 'layersKey';
const PANEL_ID = 'layersKey';
const SWATCH_SIZE = 20;

// the same "layers" icon the datasets plugin registers - kept under our own id so this
// plugin does not depend on, or override, another plugin's icon registration
const LAYERS_ICON_SVG =
	'<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"></path>' +
	'<path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"></path>' +
	'<path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"></path>';

// the datasets plugin's default style - a dataset with no style still draws a red outline
const DEFAULT_STYLE = { stroke: '#d4351c', strokeWidth: 2 };
const DEFAULT_SWATCH_FILL = '#1d70b8';

// dataset style props that become symbol tokens once the 'symbol' prefix is stripped
// (symbolBackgroundColor → backgroundColor) - mirrors the component's SYMBOL_STYLE_PROPS
const SYMBOL_TOKEN_PROPS = ['symbolBackgroundColor', 'symbolForegroundColor', 'symbolHaloWidth', 'symbolGraphic'];

/**
 * Resolve a style value that may be a plain colour string or a map-style-keyed object
 * (`{ outdoor: '#ff0000', dark: '#ffffff' }`) - same rule as the component's getValueForStyle.
 *
 * @param {string | object | undefined} value
 * @param {string | undefined} mapStyleId
 * @returns {string | null}
 */
export function styleValue(value, mapStyleId) {
	if (typeof value === 'string') {
		return value.trim() || null;
	}
	if (value && typeof value === 'object') {
		return value[mapStyleId] ?? Object.values(value)[0] ?? null;
	}
	return null;
}

/**
 * The style a dataset or sublayer actually draws with: defaults, then the dataset's style,
 * then the sublayer's overrides.
 *
 * @param {object} dataset
 * @param {object | undefined} [sublayer]
 * @returns {object}
 */
export function mergedDatasetStyle(dataset, sublayer) {
	return { ...DEFAULT_STYLE, ...(dataset?.style ?? {}), ...(sublayer?.style ?? {}) };
}

/**
 * One row of the panel. `id` is the registry id - `${datasetId}-${sublayerId}` for sublayers,
 * the dataset's own id otherwise. `sublayerId` is set only for sublayer rows, and pairs with
 * `datasetId` for the datasets plugin's setDatasetVisibility scope.
 */
function menuItem(dataset, sublayer) {
	const def = sublayer ?? dataset;
	return {
		id: sublayer ? `${dataset.id}-${sublayer.id}` : dataset.id,
		label: def.label ?? dataset.label,
		datasetId: dataset.id,
		sublayerId: sublayer?.id,
		visible: def.visible !== false,
		style: mergedDatasetStyle(dataset, sublayer)
	};
}

/**
 * The panel's rows, grouped exactly like the datasets plugin's own menu: a dataset with
 * menu-visible sublayers lists them under the dataset's label; plain datasets group under
 * `groupLabel`; anything else is a single unlabelled row.
 *
 * @param {object[]} datasets
 * @returns {{ id: string, groupLabel?: string, items: object[] }[]}
 */
export function buildLayersMenu(datasets = []) {
	const groups = [];
	const byGroupLabel = new Map();

	for (const dataset of datasets) {
		const sublayers = dataset.sublayers ?? [];
		const menuSublayers = sublayers.filter((sublayer) =>
			dataset.showInMenu ? sublayer.showInMenu !== false : sublayer.showInMenu
		);
		if (!dataset.showInMenu && menuSublayers.length === 0) {
			continue;
		}

		if (sublayers.length > 0) {
			if (menuSublayers.length > 0) {
				groups.push({
					id: dataset.id,
					groupLabel: dataset.label,
					items: menuSublayers.map((sublayer) => menuItem(dataset, sublayer))
				});
			} else {
				// every sublayer opted out of the menu - the dataset itself is the row
				groups.push({ id: dataset.id, items: [menuItem(dataset)] });
			}
			continue;
		}

		if (dataset.groupLabel) {
			let group = byGroupLabel.get(dataset.groupLabel);
			if (!group) {
				group = { id: dataset.groupLabel, groupLabel: dataset.groupLabel, items: [] };
				byGroupLabel.set(dataset.groupLabel, group);
				groups.push(group);
			}
			group.items.push(menuItem(dataset));
			continue;
		}

		groups.push({ id: dataset.id, items: [menuItem(dataset)] });
	}

	return groups;
}

function symbolTokens(style) {
	const tokens = {};
	for (const prop of SYMBOL_TOKEN_PROPS) {
		if (style[prop] != null) {
			tokens[prop.charAt(6).toLowerCase() + prop.slice(7)] = style[prop];
		}
	}
	return tokens;
}

/**
 * What to draw for a row's key symbol. Mirrors the map-key plugin's rules: symbol styles show
 * the resolved symbol SVG, patterns show the pattern swatch, a `fill` shows a shape, and a
 * stroke with no fill shows a line.
 *
 * @param {object} style - merged style from mergedDatasetStyle
 * @param {object} deps
 * @param {object | undefined} deps.mapStyle - `mapState.mapStyle` (id + theme colours)
 * @param {object | undefined} deps.symbolRegistry - `services.symbolRegistry`
 * @param {object | undefined} deps.patternRegistry - `services.patternRegistry`
 * @returns {{ shape: string, svgContent?: string, border?: string, content?: string, viewBox?: string,
 *   fill?: string | null, stroke?: string | null, strokeWidth?: number }}
 */
export function buildSwatch(style = {}, { mapStyle, symbolRegistry, patternRegistry } = {}) {
	const mapStyleId = mapStyle?.id;
	const stroke = styleValue(style.stroke, mapStyleId);
	const strokeWidth = style.strokeWidth ?? 2;
	const fill = styleValue(style.fill, mapStyleId);

	if (style.symbol || style.symbolSvgContent) {
		const symbolDef = symbolRegistry?.getSymbolDef?.(style);
		const svgContent = symbolDef ? symbolRegistry.resolve?.(symbolDef, symbolTokens(style), mapStyle) : null;
		if (svgContent) {
			const viewBox = style.symbolViewBox ?? symbolDef.viewBox ?? '0 0 38 38';
			return { shape: 'symbol', svgContent, viewBox };
		}
		// no registry (or an unresolvable symbol): a plain dot in the symbol's colour
		return { shape: 'circle', fill: styleValue(style.symbolBackgroundColor, mapStyleId) ?? DEFAULT_SWATCH_FILL };
	}

	if (style.fillPattern || style.fillPatternSvgContent) {
		const paths = patternRegistry?.getKeyPatternPaths?.(style, mapStyleId);
		if (paths) {
			return { shape: 'pattern', border: paths.border, content: paths.content };
		}
		return {
			shape: 'rect',
			fill: styleValue(style.fillPatternBackgroundColor, mapStyleId) ?? 'transparent',
			stroke: styleValue(style.fillPatternForegroundColor, mapStyleId) ?? stroke,
			strokeWidth
		};
	}

	// any `fill` (including 'transparent', for an outline-only shape) shows as a shape;
	// a stroke with no fill shows as a line. `keySymbolShape` forces the choice.
	if (fill != null && style.keySymbolShape !== 'line') {
		return { shape: 'rect', fill, stroke, strokeWidth };
	}
	if (stroke) {
		return { shape: 'line', stroke, strokeWidth };
	}
	return { shape: 'rect', fill: 'transparent', stroke: '#d4351c', strokeWidth };
}

function Swatch({ style, mapState, services }) {
	const { createElement: h } = globalThis.preactCompat;
	const swatch = buildSwatch(style, {
		mapStyle: mapState?.mapStyle,
		symbolRegistry: services?.symbolRegistry,
		patternRegistry: services?.patternRegistry
	});
	const svgProps = {
		xmlns: 'http://www.w3.org/2000/svg',
		width: SWATCH_SIZE,
		height: SWATCH_SIZE,
		viewBox: swatch.viewBox ?? `0 0 ${SWATCH_SIZE} ${SWATCH_SIZE}`,
		className: 'app-layers-key__swatch',
		'aria-hidden': 'true',
		focusable: 'false'
	};

	if (swatch.shape === 'symbol') {
		return h('svg', svgProps, h('g', { dangerouslySetInnerHTML: { __html: swatch.svgContent } }));
	}
	if (swatch.shape === 'pattern') {
		return h('svg', svgProps, [
			h('g', { key: 'border', dangerouslySetInnerHTML: { __html: swatch.border } }),
			h('g', { key: 'content', transform: 'translate(2, 2)', dangerouslySetInnerHTML: { __html: swatch.content } })
		]);
	}
	if (swatch.shape === 'line') {
		const half = swatch.strokeWidth / 2;
		return h(
			'svg',
			svgProps,
			h('line', {
				x1: half,
				y1: SWATCH_SIZE / 2,
				x2: SWATCH_SIZE - half,
				y2: SWATCH_SIZE / 2,
				stroke: swatch.stroke,
				strokeWidth: swatch.strokeWidth,
				strokeLinecap: 'round'
			})
		);
	}
	if (swatch.shape === 'circle') {
		return h('svg', svgProps, h('circle', { cx: SWATCH_SIZE / 2, cy: SWATCH_SIZE / 2, r: 7, fill: swatch.fill }));
	}
	const size = SWATCH_SIZE - swatch.strokeWidth;
	return h(
		'svg',
		svgProps,
		h('rect', {
			x: swatch.strokeWidth / 2,
			y: swatch.strokeWidth / 2,
			width: size,
			height: size,
			rx: swatch.strokeWidth,
			ry: swatch.strokeWidth,
			fill: swatch.fill,
			stroke: swatch.stroke,
			strokeWidth: swatch.strokeWidth,
			strokeLinejoin: 'round'
		})
	);
}

/**
 * The panel body. Rendered by the component's slot system inside a standard panel - it mounts
 * when the panel opens and unmounts when it closes, so per-open state is rebuilt each time
 * (the durable "what did the user last check" record lives on pluginConfig.checkedCache,
 * which belongs to the plugin descriptor and survives remounts).
 */
export function LayersKeyPanel({ pluginConfig, appConfig, mapState, services }) {
	const { createElement: h, useEffect, useMemo, useRef, useState } = globalThis.preactCompat;

	const datasets = pluginConfig.datasets ?? [];
	const checkedCache = pluginConfig.checkedCache ?? new Map();
	const groups = useMemo(() => buildLayersMenu(datasets), [datasets]);
	const hasGroups = groups.some((group) => group.groupLabel);

	// the shared dataset registry, when the datasets plugin has published it
	const registryRef = useRef(null);
	const [, setRevision] = useState(0);
	const refresh = () => setRevision((n) => n + 1);

	useEffect(() => {
		const { eventBus } = services ?? {};
		if (!eventBus) {
			return undefined;
		}
		const requestRegistry = () =>
			eventBus.requestOnce('datasets:registry', (registry) => {
				registryRef.current = registry;
				refresh();
			});
		requestRegistry();
		// the registry is only attached once the datasets plugin has initialised - if this panel
		// somehow opened before that, try again when it reports ready
		eventBus.once('datasets:ready', requestRegistry);
		eventBus.on('datasets:changed', refresh);
		return () => eventBus.off('datasets:changed', refresh);
	}, [services]);

	// The registry is a singleton shared by every map on the page - only read checked state from
	// it while it holds this map's datasets (it re-attaches on every change, so after a toggle
	// from this panel it points here). Rows toggled from this panel are authoritative via the
	// cache; the registry covers rows changed by other code.
	const registry = registryRef.current;
	const registryIsOurs =
		Boolean(registry?.datasets) && datasets.length > 0 && datasets.every((d) => registry.datasets[d.id]);
	const checkedFor = (item) =>
		checkedCache.get(item.id) ??
		(registryIsOurs ? registry.getDataset(item.id)?.isLocallyVisible : undefined) ??
		item.visible;
	const effectiveVisibleFor = (item) =>
		registryIsOurs ? (registry.getDataset(item.id)?.visible ?? checkedFor(item)) : checkedFor(item);

	const onToggle = (item) => (event) => {
		const checked = Boolean(event.target.checked);
		checkedCache.set(item.id, checked);
		const scope = item.sublayerId
			? { datasetId: item.datasetId, sublayerId: item.sublayerId }
			: { datasetId: item.datasetId };
		services?.getPlugin?.('datasets')?.setDatasetVisibility?.(checked, scope);
		refresh();
	};

	if (groups.length === 0) {
		return h('p', { className: 'govuk-body-s' }, pluginConfig.emptyText ?? 'No layers to show');
	}

	const idPrefix = `${appConfig?.id ?? 'map'}-${PANEL_ID}`;

	const renderItem = (item) => {
		const checked = checkedFor(item);
		const inputId = `${idPrefix}-${item.id}`;
		const itemClass = `im-c-datasets-layers__item govuk-checkboxes govuk-checkboxes--small${
			effectiveVisibleFor(item) ? '' : ' im-c-datasets-layers__item--checked'
		}`;
		const symbolDescription = styleValue(item.style.symbolDescription, mapState?.mapStyle?.id);
		return h(
			'div',
			{ key: item.id, className: itemClass, 'data-module': 'govuk-checkboxes' },
			h('div', { className: 'govuk-checkboxes__item' }, [
				h('input', {
					key: 'input',
					className: 'govuk-checkboxes__input',
					id: inputId,
					name: 'layers',
					type: 'checkbox',
					value: item.id,
					checked,
					onChange: onToggle(item)
				}),
				h(
					'label',
					{
						key: 'label',
						className: 'im-c-datasets-layers__item-label govuk-label govuk-checkboxes__label app-layers-key__label',
						htmlFor: inputId
					},
					[
						h(Swatch, { key: 'swatch', style: item.style, mapState, services }),
						h('span', { key: 'text', className: 'app-layers-key__text' }, [
							item.label,
							symbolDescription ? h('span', { className: 'govuk-visually-hidden' }, ` (${symbolDescription})`) : null
						])
					]
				)
			])
		);
	};

	return h(
		'div',
		{ className: `im-c-datasets-layers app-layers-key${hasGroups ? ' im-c-datasets-layers--has-groups' : ''}` },
		groups.map((group) =>
			group.groupLabel
				? h(
						'div',
						{ key: group.id, className: 'govuk-form-group im-c-datasets-layers-group' },
						h('fieldset', { className: 'im-c-datasets-layers-group__fieldset' }, [
							h(
								'legend',
								{ key: 'legend', className: 'im-c-datasets-layers-group__legend' },
								h('h3', null, group.groupLabel)
							),
							...group.items.map(renderItem)
						])
					)
				: h('div', { key: group.id }, group.items.map(renderItem))
		)
	);
}

/**
 * Guard for the manifest's render entry: if the map bundle has not exposed preactCompat
 * (e.g. an unexpected ESM build), the panel opens empty rather than crashing the map.
 */
function LayersKeyPanelShell(props) {
	const compat = globalThis.preactCompat;
	return compat?.createElement ? compat.createElement(LayersKeyPanel, props) : null;
}

const manifest = {
	icons: [{ id: 'app-layers-key', svgContent: LAYERS_ICON_SVG }],
	buttons: [
		{
			id: BUTTON_ID,
			label: ({ pluginConfig }) => pluginConfig.buttonLabel ?? 'Layers',
			panelId: PANEL_ID,
			iconId: 'app-layers-key',
			mobile: { slot: 'top-left', showLabel: true },
			tablet: { slot: 'top-left', showLabel: true },
			desktop: { slot: 'top-left', showLabel: true }
		}
	],
	panels: [
		{
			id: PANEL_ID,
			label: ({ pluginConfig }) => pluginConfig.panelLabel ?? 'Layers',
			mobile: { slot: 'drawer', modal: true, dismissible: true },
			tablet: { slot: 'left-top', dismissible: true, exclusive: true, width: '280px' },
			desktop: { slot: 'left-top', dismissible: true, exclusive: true, width: '280px' },
			render: LayersKeyPanelShell
		}
	]
};

/**
 * @param {object} [options]
 * @param {object[]} [options.datasets] - the same array passed to `defra.datasetsPlugin`
 * @param {string} [options.buttonLabel] - toolbar button text (default 'Layers')
 * @param {string} [options.panelLabel] - panel heading (default 'Layers')
 * @param {string} [options.emptyText] - shown when no dataset is menu-visible
 * @returns {object} PluginDescriptor for InteractiveMap's `plugins` option
 */
export function createLayersKeyPlugin(options = {}) {
	return {
		id: 'layersKey',
		buttonLabel: options.buttonLabel,
		panelLabel: options.panelLabel,
		emptyText: options.emptyText,
		datasets: options.datasets ?? [],
		// per-map-instance record of what the user last checked; survives the panel's
		// unmount-on-close so rows don't revert to their initial `visible` values
		checkedCache: new Map(),
		load: async () => manifest
	};
}
