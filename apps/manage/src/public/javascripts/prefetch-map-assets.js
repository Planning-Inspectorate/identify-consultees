/**
 * Prime the interactive map's assets into the HTTP cache while the homepage is
 * idle. Every journey reaches a map, so the page's own network quiet time
 * warms the bundles a later page will request: nothing is fetched until after
 * `load`, then only inside an idle callback, so the priming can never compete
 * with the homepage's own resources. Browsers that support
 * `<link rel="prefetch">` get those (the lowest-priority, next-navigation
 * hint); others - Safari, where prefetch is still flag-gated - get a
 * `fetch()` whose consumed body lands in the same HTTP cache the map page's
 * `<script>`/`<link>` tags later hit.
 */

const DATA_ISLAND_ID = 'prefetch-map-assets-data';
const VALID_AS_TYPES = new Set(['script', 'style']);

/**
 * The island's [{ href, as }] list - nothing when it is absent, malformed, or
 * holds no usable entries.
 * @param {Document | undefined} documentTarget
 * @returns {{ href: string, as: string }[]}
 */
export function prefetchAssets(documentTarget = globalThis.document) {
	const island = documentTarget?.getElementById(DATA_ISLAND_ID);
	if (!island) {
		return [];
	}
	try {
		const parsed = JSON.parse(island.textContent);
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed.filter(
			(asset) => asset && typeof asset.href === 'string' && asset.href !== '' && VALID_AS_TYPES.has(asset.as)
		);
	} catch {
		return [];
	}
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
 * One prefetch link per asset, at the lowest fetch priority.
 * @param {{ href: string, as: string }[]} assets
 * @param {Document} documentTarget
 */
export function injectPrefetchLinks(assets, documentTarget) {
	for (const asset of assets) {
		const link = documentTarget.createElement('link');
		link.rel = 'prefetch';
		link.href = asset.href;
		link.setAttribute('as', asset.as);
		link.setAttribute('fetchpriority', 'low');
		documentTarget.head.appendChild(link);
	}
}

/**
 * The no-prefetch fallback: low-priority fetches whose responses are fully
 * consumed so they are committed to the HTTP cache for the next page's
 * `<script>`/`<link>` to hit. Failures are ignored - a missed prime only
 * means the map loads as it does today.
 * @param {{ href: string }[]} assets
 * @param {Window} windowTarget
 */
export async function warmCacheWithFetch(assets, windowTarget) {
	await Promise.all(
		assets.map(async ({ href }) => {
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
 * Reads the page's asset island and primes it once the page has loaded and
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
			const assets = prefetchAssets(documentTarget);
			if (assets.length === 0) {
				return;
			}
			if (supportsLinkPrefetch(documentTarget)) {
				injectPrefetchLinks(assets, documentTarget);
			} else {
				void warmCacheWithFetch(assets, view);
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
