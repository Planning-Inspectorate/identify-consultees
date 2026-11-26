/**
 * Full-page loading overlay for the journey's slow navigations: the ruleset
 * picker's "Identify consultees" (the POST runs the ruleset, and the check page
 * it redirects to can take a while to load), the boundary page's "Continue"
 * (whose Change flow returns straight to that check page), and the check page's
 * "Create report" (which builds the report ZIP before the created page can
 * render). Elements opt in with `data-loading-spinner`; `data-loading-text`
 * sets the message under the spinner - "Loading" without it.
 *
 * The overlay only exists once this module has run - submits and clicks stay
 * plain navigations without it, so the no-JS journey is untouched and there is
 * no server-rendered markup to hide for noscript. It sits over the departing
 * page, which the browser keeps painted until the next document can render, so
 * it covers the POST, the redirect and the following page's load in one. While
 * it is up the rest of the page is inert, so keyboard and assistive-technology
 * users cannot reach the content beneath the spinner.
 *
 * A page pulled back out of the back/forward cache keeps the DOM it was
 * snapshotted with - overlay included - so it is dropped on pagehide (before
 * the snapshot) and again on pageshow, in case a browser restores one without
 * the other. Both events predate the back/forward cache itself, so no feature
 * detection is needed; where neither fires the page was never cached.
 */

const OVERLAY_CLASS = 'indicator-loading';
const LEAVING_CLASS = 'indicator-loading--leaving';
const TEXT_CLASS = 'indicator-loading__text';
const TRIGGER_SELECTOR = '[data-loading-spinner]';
const DEFAULT_TEXT = 'Loading';

// a little longer than the 160ms --leaving fade in govuk-overrides.scss, so the
// removal lands after the transition's last frame rather than snapping it off
const REMOVE_AFTER_MS = 220;

// the elements applyLoadingInert made inert, per document, so clearLoadingInert
// only ever lifts the attribute it added - a page that was already inert keeps it
const inertedByDocument = new WeakMap();

/**
 * The overlay DOM: the indicator spinner plus the message, announced politely -
 * the same contract as the map's loading overlay (map-loading-plugin.mjs).
 *
 * @param {Document} documentTarget
 * @param {string} text
 * @returns {HTMLElement}
 */
function buildOverlay(documentTarget, text) {
	const overlay = documentTarget.createElement('div');
	overlay.className = OVERLAY_CLASS;
	overlay.setAttribute('role', 'status');

	const spinner = documentTarget.createElement('div');
	spinner.className = 'indicator-loading-spinner';
	spinner.setAttribute('aria-hidden', 'true');

	const container = documentTarget.createElement('div');
	container.className = 'indicator-loading-spinner__container';

	const icon = documentTarget.createElement('div');
	icon.className = 'indicator-loading-spinner__icon';

	const label = documentTarget.createElement('span');
	label.className = TEXT_CLASS;
	label.textContent = text;

	container.append(icon);
	spinner.append(container);
	overlay.append(spinner, label);
	return overlay;
}

/**
 * The elements this module has made inert for `documentTarget`.
 * @param {Document} documentTarget
 * @returns {Set<Element>}
 */
function inertedSet(documentTarget) {
	let tracked = inertedByDocument.get(documentTarget);
	if (!tracked) {
		tracked = new Set();
		inertedByDocument.set(documentTarget, tracked);
	}
	return tracked;
}

/**
 * Make everything on the page except `overlay` inert while it is up, so keyboard
 * and assistive-technology users cannot tab or click into the content beneath the
 * spinner. Elements that were already inert are left alone.
 *
 * @param {Document} documentTarget
 * @param {HTMLElement} overlay
 */
function applyLoadingInert(documentTarget, overlay) {
	const tracked = inertedSet(documentTarget);
	for (const element of documentTarget.body.children) {
		if (element === overlay || element.hasAttribute('inert')) {
			continue;
		}
		element.setAttribute('inert', '');
		tracked.add(element);
	}
}

/**
 * Undo applyLoadingInert once no overlay remains: drop `inert` only from the
 * elements it added.
 *
 * @param {Document} documentTarget
 */
function clearLoadingInert(documentTarget) {
	const tracked = inertedSet(documentTarget);
	for (const element of tracked) {
		element.removeAttribute('inert');
	}
	tracked.clear();
}

/**
 * Cover the page with the loading overlay. A second call while one is up does
 * nothing - two rapid submissions leave one overlay, not a stack.
 *
 * @param {Document | undefined} documentTarget
 * @param {string} [text]
 */
export function showLoadingOverlay(documentTarget, text = DEFAULT_TEXT) {
	if (!documentTarget?.body) {
		return;
	}
	const existing = documentTarget.querySelector(`.${OVERLAY_CLASS}`);
	if (existing && !existing.classList.contains(LEAVING_CLASS)) {
		return;
	}
	// a mid-fade overlay counts as gone - drop it and let the fresh one fade in
	existing?.remove();
	const overlay = buildOverlay(documentTarget, text);
	documentTarget.body.append(overlay);
	applyLoadingInert(documentTarget, overlay);
}

/**
 * Fade the overlay out, then drop it - the CSS transition on --leaving does the
 * motion, so the element has to stay mounted until the fade has played. Where
 * transitions do not run (no support, reduced motion) the class still clears
 * the overlay visually and the timeout removes it moments later. A second call
 * while one is in flight just re-arms the removal.
 *
 * @param {Document | undefined} documentTarget
 */
export function removeLoadingOverlay(documentTarget) {
	const overlay = documentTarget?.querySelector(`.${OVERLAY_CLASS}`);
	if (!overlay) {
		return;
	}
	overlay.classList.add(LEAVING_CLASS);
	setTimeout(() => {
		overlay.remove();
		// a replacement overlay's own removal lifts the inert state - this timer
		// can outlive the overlay it was armed for when showLoadingOverlay swaps
		// a mid-fade one out early
		if (!documentTarget.querySelector(`.${OVERLAY_CLASS}`)) {
			clearLoadingInert(documentTarget);
		}
	}, REMOVE_AFTER_MS);
}

/**
 * Wire one `data-loading-spinner` element: a form shows the overlay on submit,
 * anything else (the link styled as a button) on click. The action itself is
 * never intercepted - the overlay is decoration over a navigation that proceeds
 * exactly as it would without the script.
 *
 * @param {HTMLElement} element
 */
export function enhanceLoadingTrigger(element) {
	const eventName = element.tagName === 'FORM' ? 'submit' : 'click';
	element.addEventListener(eventName, (event) => {
		// a handler that ran first and cancelled the action - govuk-frontend's
		// double-click debounce, say - means no navigation is coming
		if (event.defaultPrevented) {
			return;
		}
		showLoadingOverlay(element.ownerDocument, element.dataset.loadingText || DEFAULT_TEXT);
	});
}

/**
 * Run once the page has loaded - module scripts are deferred by default.
 * @param {Document | undefined} documentTarget
 */
export function registerLoadingSpinners(documentTarget = globalThis.document) {
	if (!documentTarget) {
		return;
	}
	const init = () => {
		for (const element of documentTarget.querySelectorAll(TRIGGER_SELECTOR)) {
			enhanceLoadingTrigger(element);
		}
		const view = documentTarget.defaultView;
		view?.addEventListener('pagehide', () => removeLoadingOverlay(documentTarget));
		view?.addEventListener('pageshow', () => removeLoadingOverlay(documentTarget));
	};
	if (documentTarget.readyState === 'loading') {
		documentTarget.addEventListener('DOMContentLoaded', init);
		return;
	}
	init();
}

registerLoadingSpinners();
