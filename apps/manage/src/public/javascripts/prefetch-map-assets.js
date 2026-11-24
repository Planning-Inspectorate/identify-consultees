/**
 * Prime the interactive map's assets into the HTTP cache while the homepage is
 * idle. Every journey reaches a map, so the page's own network quiet time
 * warms the bundles a later page will request: nothing is fetched until after
 * `load`, then only inside an idle callback, so the priming can never compete
 * with the homepage's own resources. The server renders the hints as an inert
 * `<template>` of `<link rel="prefetch">` nodes - browsers that support link
 * prefetch get those nodes adopted into `<head>`; others - Safari, where
 * prefetch is still flag-gated - get a `fetch()` whose consumed body lands in
 * the same HTTP cache the map page's `<script>`/`<link>` tags later hit.
 */

const DATA_ISLAND_ID = 'prefetch-map-assets-data';

/**
 * The island's inert `<template>` of server-rendered prefetch links - undefined
 * when the page has none. The hrefs are same-origin paths escaped by the
 * template engine, so the nodes are adopted verbatim rather than rebuilt.
 * @param {Document | undefined} documentTarget
 * @returns {HTMLTemplateElement | undefined}
 */
export function prefetchTemplate(documentTarget = globalThis.document) {
	const template = documentTarget?.getElementById(DATA_ISLAND_ID);
	return template?.content ? template : undefined;
}

/**
 * Whether this browser fetches `<link rel="prefetch">` hints - false on
 * Safari, whose prefetch support is still behind a flag.
 * @param {Document} documentTarget
 * @returns {boolean}
 */
export function supportsLinkPrefetch(documentTarget) {
	const link = documentTarget.createElement('link');
	return typeof link.relList?.supports === 'function' && link.relList.supports('prefetch');
}

/**
 * Adopts the island's prefetch links into `<head>`. The template's content is
 * inert until cloned into the live document; the clones keep the server's
 * href/as/fetchpriority attributes untouched.
 * @param {HTMLTemplateElement} template
 * @param {Document} documentTarget
 */
export function injectPrefetchLinks(template, documentTarget) {
	documentTarget.head.appendChild(template.content.cloneNode(true));
}

/**
 * The no-prefetch fallback: low-priority fetches for each of the island's link
 * hrefs, every response fully consumed so it is committed to the HTTP cache for
 * the next page's `<script>`/`<link>` to hit. Failures are ignored - a missed
 * prime only means the map loads as it does today.
 * @param {HTMLTemplateElement} template
 * @param {Window} windowTarget
 */
export async function warmCacheWithFetch(template, windowTarget) {
	const hrefs = Array.from(template.content.querySelectorAll('link[href]'), (link) => link.getAttribute('href'));
	await Promise.all(
		hrefs.map(async (href) => {
			try {
				const response = await windowTarget.fetch(href, { priority: 'low' });
				await response.arrayBuffer();
			} catch {
				// best-effort priming - nothing to do
			}
		})
	);
}

/**
 * Runs `task` during idle time: requestIdleCallback where it exists (not
 * Safari), a short timeout otherwise. The timeout bounds how long a busy main
 * thread can postpone the priming.
 * @param {Window} windowTarget
 * @param {() => void} task
 */
export function duringIdleTime(windowTarget, task) {
	if (typeof windowTarget.requestIdleCallback === 'function') {
		windowTarget.requestIdleCallback(task, { timeout: 4000 });
		return;
	}
	windowTarget.setTimeout(task, 1);
}

/**
 * Adopts the page's server-rendered prefetch hints once the page has loaded and
 * gone idle.
 * @param {Document | undefined} documentTarget
 */
export function registerPrefetchMapAssets(documentTarget = globalThis.document) {
	const view = documentTarget?.defaultView;
	if (!documentTarget || !view) {
		return;
	}

	const prime = () => {
		duringIdleTime(view, () => {
			const template = prefetchTemplate(documentTarget);
			if (!template) {
				return;
			}
			if (supportsLinkPrefetch(documentTarget)) {
				injectPrefetchLinks(template, documentTarget);
			} else {
				void warmCacheWithFetch(template, view);
			}
		});
	};

	if (documentTarget.readyState === 'complete') {
		prime();
		return;
	}
	view.addEventListener('load', prime, { once: true });
}

registerPrefetchMapAssets();
