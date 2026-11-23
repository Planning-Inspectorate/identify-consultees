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
 * it covers the POST, the redirect and the following page's load in one.
 *
 * A page pulled back out of the back/forward cache keeps the DOM it was
 * snapshotted with - overlay included - so it is dropped on pagehide (before
 * the snapshot) and again on pageshow, in case a browser restores one without
 * the other. Both events predate the back/forward cache itself, so no feature
 * detection is needed; where neither fires the page was never cached.
 */

const OVERLAY_CLASS = 'indicator-loading';
const TEXT_CLASS = 'indicator-loading__text';
const TRIGGER_SELECTOR = '[data-loading-spinner]';
const DEFAULT_TEXT = 'Loading';

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
 * Cover the page with the loading overlay. A second call while one is up does
 * nothing - two rapid submissions leave one overlay, not a stack.
 *
 * @param {Document | undefined} documentTarget
 * @param {string} [text]
 */
export function showLoadingOverlay(documentTarget, text = DEFAULT_TEXT) {
	if (!documentTarget?.body || documentTarget.querySelector(`.${OVERLAY_CLASS}`)) {
		return;
	}
	documentTarget.body.append(buildOverlay(documentTarget, text));
}

/**
 * Drop the overlay if one is up - the back/forward-cache cleanup, and the way
 * tests reset between cases.
 *
 * @param {Document | undefined} documentTarget
 */
export function removeLoadingOverlay(documentTarget) {
	documentTarget?.querySelector(`.${OVERLAY_CLASS}`)?.remove();
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
