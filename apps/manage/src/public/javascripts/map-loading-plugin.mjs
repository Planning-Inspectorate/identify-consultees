/**
 * Loading overlay plugin for the Defra Interactive Map.
 *
 * The component has no built-in loading message: `im-is-loading` only hides the
 * page body until the app mounts, and a plugin manifest can't help either - a
 * plugin's load() runs inside loadApp(), after the im-core and provider chunks
 * have downloaded, so nothing registered there can cover the chunk-download
 * phase. The `middle` slot is documented for loading screens but only exists
 * once the React app has mounted, and createRoot() discards anything already
 * inside the container at that point.
 *
 * This plugin therefore manages the overlay itself, outside the app: the map
 * container is wrapped in a positioned div and the overlay appended as a
 * sibling, so it survives the React mount and covers the whole window from
 * script execution to tiles-idle. If the page server-rendered an overlay inside
 * the container (`.app-map-loading`) it is adopted - moved out of the container
 * before replaceChildren()/createRoot() would discard it.
 *
 *   const loading = createMapLoadingPlugin({ container });
 *   const map = new defra.InteractiveMap(mapId, { ..., plugins: [loading, ...] });
 *   map.on('map:firstidle', () => loading.dismiss());
 *
 * Dismissal triggers on `map:firstidle` (the first MapLibre `idle`, when every
 * source and tile has settled - the provider emits it once), when the component
 * renders its `.im-c-error` failure markup, or when the caller's catch shows
 * the static fallback. The provider does not forward MapLibre `error` events,
 * so a timeout dismisses anyway rather than leaving the overlay over a map that
 * will never reach idle.
 *
 * Suited to `behaviour: 'inline'` only: for buttonFirst the collapsed container
 * is just the launcher button, and for fullscreen variants the app escapes the
 * wrapper (position: fixed) so a sibling overlay cannot cover it.
 */

import { watchForMapError } from './static-map-plugin.mjs';

const WRAPPER_CLASS = 'app-map-loading-wrap';
const OVERLAY_CLASS = 'app-map-loading';
const SPINNER_CLASS = 'app-map-loading__spinner';
const TEXT_CLASS = 'app-map-loading__text';

const DEFAULT_TEXT = 'Loading map';
// generous - a healthy map reaches firstidle well inside this on slow networks;
// it exists for the case where the style/tile fetch fails silently
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * The overlay DOM: a decorative spinner plus the message, announced politely.
 *
 * @param {string} text
 * @returns {HTMLElement}
 */
function buildOverlay(text) {
	const overlay = document.createElement('div');
	overlay.className = OVERLAY_CLASS;
	overlay.setAttribute('role', 'status');

	const spinner = document.createElement('span');
	spinner.className = SPINNER_CLASS;
	spinner.setAttribute('aria-hidden', 'true');

	const label = document.createElement('span');
	label.className = TEXT_CLASS;
	label.textContent = text;

	overlay.append(spinner, label);
	return overlay;
}

/**
 * Move `overlay` next to `container`, wrapping the container in a positioned
 * div first if needed. The sibling position is what keeps the overlay alive
 * when React mounts over the container.
 *
 * @param {HTMLElement} container
 * @param {HTMLElement} overlay
 */
function mountOverlayBeside(container, overlay) {
	const parent = container.parentElement;
	if (!parent) {
		// a detached container can't be wrapped - the overlay sits inside it and
		// only covers the pre-mount phase, if it displays at all
		container.appendChild(overlay);
		return;
	}

	if (!parent.classList.contains(WRAPPER_CLASS)) {
		const wrapper = document.createElement('div');
		wrapper.className = WRAPPER_CLASS;
		parent.insertBefore(wrapper, container);
		wrapper.appendChild(container);
	}
	container.parentElement.appendChild(overlay);
}

/**
 * Remove the loading overlay `plugin` created: the overlay element itself, the
 * failure watcher and the safety timeout. The positioned wrapper is left in
 * place - it is inert once the app has mounted, and unwrapping would reparent
 * the live React root mid-lifecycle.
 *
 * @param {object} state
 */
function dismissOverlay(state) {
	state.stopWatching();
	clearTimeout(state.timer);
	state.overlay.remove();
}

/**
 * @param {object} [options]
 * @param {HTMLElement} [options.container] - the map's container element
 * @param {string} [options.text] - the message under the spinner
 * @param {number} [options.timeoutMs] - dismiss anyway after this long;
 *   `map:firstidle` never comes if the style or tile fetches hang, and the
 *   provider forwards no error event for them. 0 disables the timeout
 * @returns {object} PluginDescriptor for InteractiveMap's `plugins` option,
 *   with a `dismiss()` helper for the event/failure paths the plugin can't
 *   reach itself (plugins only mount after the chunks and app have loaded)
 */
export function createMapLoadingPlugin(options = {}) {
	const { container, text = DEFAULT_TEXT, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

	if (!container) {
		return {
			id: 'mapLoading',
			load: async () => ({}),
			dismiss: () => {}
		};
	}

	// a server-rendered overlay (visible since first paint, hidden by noscript
	// styling) is adopted rather than rebuilt, so there is one seamless overlay
	const overlay = container.querySelector(`.${OVERLAY_CLASS}`) ?? buildOverlay(text);
	mountOverlayBeside(container, overlay);

	const state = { overlay, timer: undefined, stopWatching: () => {} };
	state.timer = timeoutMs > 0 ? setTimeout(() => dismissOverlay(state), timeoutMs) : undefined;
	// watchForMapError can call back synchronously (a pre-existing .im-c-error),
	// so state has to exist before it is armed
	state.stopWatching = watchForMapError(container, () => dismissOverlay(state));

	return {
		id: 'mapLoading',
		load: async () => ({}),
		dismiss: () => dismissOverlay(state)
	};
}
