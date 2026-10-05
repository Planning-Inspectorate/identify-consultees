/**
 * Initialise the Defra Interactive Map examples on the hidden
 * /components/interactive-map showcase pages.
 *
 * One page = one example. The `<mapId>-data` JSON block (rendered server-side
 * from the example registry) declares which plugins to wire and any options
 * they need; `kind` selects the example-specific event wiring.
 *
 * Progressive enhancement: if the Defra bundles did not load or init throws,
 * the server-rendered static map (from `config.fallback`) is injected — the
 * same image the <noscript> fallback shows. The static image is only requested
 * on that failure path; a working map never downloads it.
 */

/**
 * @param {string} mapId
 * @returns {object | null}
 */
export function readMapConfig(mapId) {
	const el = document.getElementById(`${mapId}-data`);
	if (!(el instanceof HTMLScriptElement)) {
		return null;
	}

	try {
		return JSON.parse(el.text || el.textContent || '');
	} catch {
		return null;
	}
}

/**
 * Inject the cached server-rendered static map when the interactive map
 * cannot start (missing bundles, init error). Fallback details come from
 * the page's JSON config — data-* attributes can't be used because the
 * InteractiveMap constructor JSON.parses every one it finds.
 *
 * @param {HTMLElement} container
 * @param {object | undefined} fallback - `config.fallback` from the JSON block
 */
export function showStaticMapFallback(container, fallback) {
	// the server-rendered feature list is hidden while the interactive map is
	// expected to work — reveal it whenever we fall back to the static image
	document.getElementById(`${container.id}-fallback`)?.removeAttribute('hidden');

	if (container.querySelector('.app-case-map-static')) {
		return;
	}

	if (!fallback?.src) {
		container.textContent = 'The interactive map could not load.';
		return;
	}

	const src = fallback.src;
	const alt = fallback.alt ?? '';
	const width = fallback.width || 960;
	const height = fallback.height || 516;

	const img = document.createElement('img');
	img.className = 'app-case-map-static';
	img.src = src;
	img.alt = alt;
	img.width = width;
	img.height = height;

	const hint = document.createElement('p');
	hint.className = 'govuk-body app-case-map-js-hint';
	hint.textContent = 'The interactive map could not load. A static map of the same area is shown instead.';

	container.replaceChildren(img);
	container.classList.remove('app-case-map-interactive');
	container.insertAdjacentElement('afterend', hint);
}

/**
 * Instantiate the vendor plugins the example's config asks for.
 *
 * @param {object} defra - window.defra globals
 * @param {object} config
 * @returns {object[]}
 */
export function buildPlugins(defra, config) {
	const plugins = [];
	let interact;
	let draw;

	if (config.datasets?.length && defra.datasetsPlugin) {
		plugins.push(defra.datasetsPlugin({ datasets: config.datasets }));
	}
	if (config.interact && defra.interactPlugin) {
		interact = defra.interactPlugin(config.interact);
		plugins.push(interact);
	}
	if (config.draw && defra.drawPlugin) {
		draw = defra.drawPlugin(config.draw);
		plugins.push(draw);
	}
	if (config.mapStyles?.length && defra.mapStylesPlugin) {
		plugins.push(defra.mapStylesPlugin({ mapStyles: config.mapStyles }));
	}
	if (config.mapKey && defra.mapKeyPlugin) {
		plugins.push(defra.mapKeyPlugin());
	}

	return { plugins, interact, draw };
}

/**
 * Panel markup target the example pages write selected-feature / marker
 * details into.
 *
 * @param {object} panel
 * @returns {string}
 */
function panelInnerId(panel) {
	return `${panel.id}-content`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
	return String(value).replace(/</g, '&lt;');
}

/**
 * @param {object} map - InteractiveMap instance
 * @param {object} config
 * @param {object | undefined} interactPlugin
 * @param {object | undefined} drawPlugin
 */
function wireExampleBehaviour(map, config, interactPlugin, drawPlugin) {
	// the core attaches plugin api methods (enable etc.) onto the plugin object
	// when the plugin mounts — at map:ready it exists, at wiring time it doesn't
	if (interactPlugin) {
		map.on('map:ready', () => interactPlugin.enable?.());
	}

	// the draw plugin renders in-session controls (Done/Cancel/Menu) itself but
	// the entry button is the consumer's job — newPolygon only works once the
	// adapter emits draw:ready, which always precedes a user click
	if (drawPlugin) {
		map.on('map:ready', () => {
			map.addButton('drawPolygon', {
				label: 'Draw polygon',
				onClick: () => drawPlugin.newPolygon?.(crypto.randomUUID())
			});
		});
	}

	if (config.marker) {
		map.on('map:ready', () => {
			map.addMarker(config.marker.id, config.marker.coords, {
				label: config.marker.label,
				showLabel: config.marker.showLabel
			});
		});
	}

	if (config.panel) {
		map.on('map:ready', () => {
			map.addPanel(config.panel.id, {
				focus: false,
				label: config.panel.label,
				html: `<div id="${panelInnerId(config.panel)}"></div>`,
				mobile: { slot: 'drawer', dismissible: true },
				tablet: { slot: 'left-top', dismissible: true, width: '300px' },
				desktop: { slot: 'left-top', dismissible: true, width: '300px' }
			});
		});
		map.on('app:panelclosed', ({ panelId }) => {
			if (panelId === config.panel.id && interactPlugin?.clear) {
				interactPlugin.clear();
			}
		});
	}

	if (config.kind === 'marker-label') {
		map.on('interact:selectionchange', ({ selectedMarkers }) => {
			map.updateMarker(config.marker.id, {
				showLabel: selectedMarkers.includes(config.marker.id)
			});
		});
	}

	if (config.kind === 'marker-panel') {
		map.on('interact:selectionchange', ({ selectedMarkers }) => {
			const target = document.getElementById(panelInnerId(config.panel));
			if (selectedMarkers.includes(config.marker.id) && target) {
				target.innerHTML = `<p class="govuk-body govuk-!-margin-bottom-1">${escapeHtml(config.panel.fallback)}</p>`;
				map.showPanel(config.panel.id);
			} else {
				map.hidePanel(config.panel.id);
			}
		});
	}

	if (config.kind === 'select-feature') {
		map.on('interact:selectionchange', ({ selectedFeatures }) => {
			const target = document.getElementById(panelInnerId(config.panel));
			if (selectedFeatures.length > 0 && target) {
				const properties = selectedFeatures[0].properties ?? {};
				const name = properties[config.panel.property] ?? config.panel.fallback;
				const detail = config.panel.detailProperty ? properties[config.panel.detailProperty] : undefined;
				target.innerHTML =
					`<p class="govuk-body govuk-!-margin-bottom-1">${escapeHtml(name)}</p>` +
					(detail
						? `<p class="govuk-body-s govuk-!-margin-bottom-1">${escapeHtml(config.panel.detailLabel ?? config.panel.detailProperty)}: ${escapeHtml(detail)}</p>`
						: '');
				map.showPanel(config.panel.id);
			} else {
				map.hidePanel(config.panel.id);
			}
		});
	}
}

/**
 * @param {string} mapId
 */
export function initInteractiveMapExample(mapId) {
	const config = readMapConfig(mapId);
	const container = document.getElementById(mapId);
	if (!container) {
		return;
	}

	const defra = window.defra;
	if (!config || !defra?.InteractiveMap || !defra.maplibreProvider) {
		showStaticMapFallback(container, config?.fallback);
		return;
	}

	container.replaceChildren();
	container.classList.add('app-case-map-interactive');

	try {
		const { plugins, interact: interactPlugin, draw: drawPlugin } = buildPlugins(defra, config);

		const mapStyle = config.mapStyles?.length ? config.mapStyles[0] : config.mapStyle;

		const map = new defra.InteractiveMap(mapId, {
			behaviour: config.behaviour ?? 'inline',
			mapProvider: defra.maplibreProvider(),
			mapStyle,
			center: config.center,
			zoom: config.zoom,
			containerHeight: `${config.height ?? 516}px`,
			mapLabel: config.mapLabel,
			// the built-in Exit button (top-left, fullscreen only) is opt-in via
			// hasExitButton — buttonFirst/hybrid maps need it to leave the map
			hasExitButton: config.hasExitButton ?? false,
			plugins,
			...(config.backAndContinue
				? {
						backAndContinue: {
							backLabel: config.backAndContinue.backLabel,
							continueLabel: config.backAndContinue.continueLabel,
							continueEnabledWhen: ({ mapState }) =>
								mapState.markers.items.some((marker) => marker.id === config.backAndContinue.requireMarkerId)
						}
					}
				: {})
		});

		wireExampleBehaviour(map, config, interactPlugin, drawPlugin);
	} catch {
		showStaticMapFallback(container, config.fallback);
	}
}

export function initAllInteractiveMapExamples() {
	for (const container of document.querySelectorAll('.app-interactive-map-example')) {
		if (container instanceof HTMLElement && container.id) {
			initInteractiveMapExample(container.id);
		}
	}
}

/**
 * @param {Document | undefined} documentTarget
 */
export function registerInteractiveMapExamples(documentTarget = globalThis.document) {
	if (!documentTarget) {
		return;
	}

	if (documentTarget.readyState === 'loading') {
		documentTarget.addEventListener('DOMContentLoaded', initAllInteractiveMapExamples);
		return;
	}

	initAllInteractiveMapExamples();
}

registerInteractiveMapExamples();
