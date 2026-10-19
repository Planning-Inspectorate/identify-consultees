/**
 * Static-map fallback plugin for the Defra Interactive Map.
 *
 * Progressive enhancement: every interactive map sits on a container that a
 * <noscript> static image already occupies for no-JavaScript users. This plugin
 * covers the other failure modes - the vendor bundles not loading, the
 * InteractiveMap constructor throwing, or the app failing to load after
 * construction - by swapping the container's contents for the same
 * server-rendered static map.
 *
 *   const staticMap = createStaticMapPlugin({ container, fallback: config.fallback });
 *   try {
 *     new defra.InteractiveMap(mapId, { ..., plugins: [staticMap, ...] });
 *   } catch {
 *     staticMap.showFallback();
 *   }
 *
 * The fallback details travel in the page's JSON config (`config.fallback`) -
 * the InteractiveMap constructor JSON.parses every data-* attribute on its
 * container, so they can't be data attributes.
 *
 * A plugin descriptor's load() only runs once the app initialises, which is
 * exactly the moment the fallback stops being needed: the descriptor therefore
 * carries `showFallback`/`stopWatching` helpers itself so the page bootstrap
 * can reach the fallback when the app never mounts. Everything except `id`,
 * `load` and `manifest` also lands in pluginConfig, per the plugin contract.
 *
 * Async load failures (a rejected `loadApp` - provider chunk, map style or
 * device-support failures) are rendered by the component as `.im-c-error`
 * markup inside the container; a try/catch around the constructor never sees
 * them. The factory arms a MutationObserver for that marker so those failures
 * reach the same static fallback.
 *
 * The file is `.mjs`, not `.js`: the build fingerprints `javascripts/*.js`
 * (content-hash renames the file), so modules importing this one need a
 * specifier that step leaves alone.
 */

const STATIC_IMAGE_CLASS = 'app-case-map-static';
const HINT_CLASS = 'app-case-map-js-hint';
const INTERACTIVE_CLASS = 'app-case-map-interactive';
// renderError() in the component writes this markup on async load failure
const ERROR_MARKER_SELECTOR = '.im-c-error';

const DEFAULT_IMAGE_WIDTH = 960;
const DEFAULT_IMAGE_HEIGHT = 516;
const DEFAULT_HINT_TEXT = 'The interactive map could not load. A static map of the same area is shown instead.';
const DEFAULT_UNAVAILABLE_TEXT = 'The interactive map could not load.';

/**
 * Swap a map container's contents for the server-rendered static map, or for
 * an explanation when no static image is configured.
 *
 * @param {HTMLElement | undefined | null} container - the map's container element
 * @param {object} [options]
 * @param {object} [options.fallback] - `config.fallback` from the page's JSON block
 * @param {string} [options.fallback.src]
 * @param {string} [options.fallback.alt]
 * @param {number} [options.fallback.width]
 * @param {number} [options.fallback.height]
 * @param {string} [options.hintText] - paragraph inserted after the container with the image
 * @param {string} [options.unavailableText] - shown inside the container when fallback has no src
 * @param {string} [options.revealId] - element to un-hide (a feature legend kept for fallback users)
 */
export function showStaticMapFallback(container, options = {}) {
	if (!container) {
		return;
	}

	// the server-rendered feature list is hidden while the interactive map is
	// expected to work - reveal it whenever we fall back to the static image
	if (options.revealId) {
		document.getElementById(options.revealId)?.removeAttribute('hidden');
	}

	if (container.querySelector(`.${STATIC_IMAGE_CLASS}`)) {
		return;
	}

	container.classList.remove(INTERACTIVE_CLASS);

	if (!options.fallback?.src) {
		const message = document.createElement('p');
		message.className = 'govuk-body';
		message.textContent = options.unavailableText ?? DEFAULT_UNAVAILABLE_TEXT;
		container.replaceChildren(message);
		return;
	}

	const img = document.createElement('img');
	img.className = STATIC_IMAGE_CLASS;
	img.src = options.fallback.src;
	img.alt = options.fallback.alt ?? '';
	img.width = options.fallback.width || DEFAULT_IMAGE_WIDTH;
	img.height = options.fallback.height || DEFAULT_IMAGE_HEIGHT;

	const hint = document.createElement('p');
	hint.className = `govuk-body ${HINT_CLASS}`;
	hint.textContent = options.hintText ?? DEFAULT_HINT_TEXT;

	container.replaceChildren(img);
	container.insertAdjacentElement('afterend', hint);
}

/**
 * Call `show` when the component renders its own `.im-c-error` markup into the
 * container. Returns a disconnect function.
 *
 * @param {HTMLElement} container
 * @param {() => void} show
 * @returns {() => void}
 */
export function watchForMapError(container, show) {
	const showIfErrored = () => {
		if (container.querySelector(ERROR_MARKER_SELECTOR)) {
			show();
		}
	};
	const observer = new MutationObserver(showIfErrored);
	observer.observe(container, { childList: true, subtree: true });
	// a synchronous checkDeviceSupport failure can render the error before
	// construction returns - treat an already-present marker the same
	showIfErrored();
	return () => observer.disconnect();
}

// the fallback lives entirely outside the mounted app, so the manifest is
// intentionally empty - the descriptor exists to carry the config and helpers
const manifest = {};

/**
 * @param {object} [options] - the same options showStaticMapFallback takes, plus `container`
 * @param {HTMLElement} [options.container] - the map's container element
 * @returns {object} PluginDescriptor for InteractiveMap's `plugins` option,
 *   with `showFallback()` and `stopWatching()` helpers for the failure paths
 *   where the app never mounts
 */
export function createStaticMapPlugin(options = {}) {
	const { container } = options;
	const showFallback = () => showStaticMapFallback(container, options);
	// armed before the map is constructed: `.im-c-error` failures are rendered
	// asynchronously by the component, where the caller's try/catch can't see them
	const stopWatching = container ? watchForMapError(container, showFallback) : () => {};

	return {
		id: 'staticMap',
		fallback: options.fallback,
		hintText: options.hintText,
		unavailableText: options.unavailableText,
		revealId: options.revealId,
		load: async () => manifest,
		showFallback,
		stopWatching
	};
}
