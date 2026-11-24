import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import {
	duringIdleTime,
	injectPrefetchLinks,
	prefetchAssets,
	registerPrefetchMapAssets,
	supportsLinkPrefetch,
	warmCacheWithFetch
} from './prefetch-map-assets.js';

function documentWith(body = '') {
	const dom = new JSDOM(`<!DOCTYPE html><html><body>${body}</body></html>`);
	return dom.window.document;
}

const ISLAND = `<script type="application/json" id="prefetch-map-assets-data">
	[{ "href": "/vendor/interactive-map/js/index-a1b2c3d4.js", "as": "script" },
	 { "href": "/vendor/interactive-map/css/index-e5f6a7b8.css", "as": "style" }]
</script>`;

/** Let a pending duringIdleTime setTimeout callback run. */
const flushIdle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('prefetchAssets', () => {
	test('reads the page island into a usable asset list', () => {
		const document = documentWith(ISLAND);
		assert.deepStrictEqual(prefetchAssets(document), [
			{ href: '/vendor/interactive-map/js/index-a1b2c3d4.js', as: 'script' },
			{ href: '/vendor/interactive-map/css/index-e5f6a7b8.css', as: 'style' }
		]);
	});

	test('returns nothing without an island, or for a document that has none', () => {
		assert.deepStrictEqual(prefetchAssets(documentWith()), []);
		assert.deepStrictEqual(prefetchAssets(undefined), []);
	});

	test('returns nothing for malformed JSON or a non-array payload', () => {
		const bad = documentWith(`<script type="application/json" id="prefetch-map-assets-data">not json</script>`);
		assert.deepStrictEqual(prefetchAssets(bad), []);
		const object = documentWith(`<script type="application/json" id="prefetch-map-assets-data">{"href":"/x"}</script>`);
		assert.deepStrictEqual(prefetchAssets(object), []);
	});

	test('drops entries that are not usable prefetch hints', () => {
		const document = documentWith(
			`<script type="application/json" id="prefetch-map-assets-data">
				[{ "href": "/a.js", "as": "script" }, { "href": "", "as": "script" },
				 { "as": "script" }, { "href": "/b.css", "as": "font" }, null]
			</script>`
		);
		assert.deepStrictEqual(prefetchAssets(document), [{ href: '/a.js', as: 'script' }]);
	});
});

describe('supportsLinkPrefetch', () => {
	test('is false where link.relList knows no prefetch (jsdom, Safari-like)', () => {
		assert.equal(supportsLinkPrefetch(documentWith()), false);
	});
});

describe('injectPrefetchLinks', () => {
	test('appends one lowest-priority prefetch link per asset', () => {
		const document = documentWith();
		injectPrefetchLinks(
			[
				{ href: '/vendor/a/index.js', as: 'script' },
				{ href: '/vendor/a/index.css', as: 'style' }
			],
			document
		);
		const links = document.querySelectorAll('link[rel="prefetch"]');
		assert.equal(links.length, 2);
		assert.equal(links[0].getAttribute('href'), '/vendor/a/index.js');
		assert.equal(links[0].getAttribute('as'), 'script');
		assert.equal(links[0].getAttribute('fetchpriority'), 'low');
		assert.equal(links[1].getAttribute('as'), 'style');
	});
});

describe('warmCacheWithFetch', () => {
	test('fetches every asset at low priority and consumes the body so it caches', async () => {
		const fetched = [];
		const view = {
			fetch: async (href, init) => {
				fetched.push({ href, init });
				return { arrayBuffer: async () => new ArrayBuffer(4) };
			}
		};
		await warmCacheWithFetch([{ href: '/vendor/a.js' }, { href: '/vendor/b.css' }], view);
		assert.deepStrictEqual(fetched, [
			{ href: '/vendor/a.js', init: { priority: 'low' } },
			{ href: '/vendor/b.css', init: { priority: 'low' } }
		]);
	});

	test('a failed prime is swallowed, not thrown', async () => {
		const view = {
			fetch: async () => {
				throw new Error('network down');
			}
		};
		await assert.doesNotReject(() => warmCacheWithFetch([{ href: '/vendor/a.js' }], view));
	});
});

describe('duringIdleTime', () => {
	test('uses requestIdleCallback where the browser has it', () => {
		const calls = [];
		const view = {
			requestIdleCallback: (task, options) => calls.push({ task, options }),
			setTimeout: () => assert.fail('setTimeout must not be used')
		};
		duringIdleTime(view, () => {});
		assert.equal(calls.length, 1);
		assert.equal(calls[0].options.timeout, 4000);
		calls[0].task();
	});

	test('falls back to a short timeout without it', async () => {
		let ran = false;
		duringIdleTime({ setTimeout: globalThis.setTimeout.bind(globalThis) }, () => {
			ran = true;
		});
		await flushIdle();
		assert.equal(ran, true);
	});
});

describe('registerPrefetchMapAssets', () => {
	test('does nothing without a document or a window to schedule on', () => {
		assert.doesNotThrow(() => registerPrefetchMapAssets(undefined));
		assert.doesNotThrow(() => registerPrefetchMapAssets({}));
	});

	test('after load, idle time injects a prefetch link per island asset', async () => {
		const document = documentWith(ISLAND);
		const view = document.defaultView;
		// jsdom reports prefetch as unsupported - pretend it is, like Chromium
		const realCreateElement = document.createElement.bind(document);
		mock.method(document, 'createElement', (tag) => {
			const element = realCreateElement(tag);
			if (tag === 'link') {
				Object.defineProperty(element, 'relList', {
					value: { supports: (rel) => rel === 'prefetch' }
				});
			}
			return element;
		});

		registerPrefetchMapAssets(document);
		assert.equal(document.querySelectorAll('link[rel="prefetch"]').length, 0);
		view.dispatchEvent(new view.Event('load'));
		await flushIdle();

		const links = document.querySelectorAll('link[rel="prefetch"]');
		assert.equal(links.length, 2);
		assert.equal(links[0].getAttribute('href'), '/vendor/interactive-map/js/index-a1b2c3d4.js');
	});

	test('without prefetch support it warms the cache with fetches instead', async () => {
		const document = documentWith(ISLAND);
		const view = document.defaultView;
		const fetched = [];
		view.fetch = async (href) => {
			fetched.push(href);
			return { arrayBuffer: async () => new ArrayBuffer(4) };
		};

		registerPrefetchMapAssets(document);
		view.dispatchEvent(new view.Event('load'));
		await flushIdle();

		assert.deepStrictEqual(fetched, [
			'/vendor/interactive-map/js/index-a1b2c3d4.js',
			'/vendor/interactive-map/css/index-e5f6a7b8.css'
		]);
	});

	test('a page already fully loaded primes straight away', async () => {
		const document = documentWith(ISLAND);
		Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
		const view = document.defaultView;
		const fetched = [];
		view.fetch = async (href) => {
			fetched.push(href);
			return { arrayBuffer: async () => new ArrayBuffer(4) };
		};

		registerPrefetchMapAssets(document);
		await flushIdle();
		assert.equal(fetched.length, 2);
	});

	test('an empty island primes nothing', async () => {
		const document = documentWith();
		const view = document.defaultView;
		const fetched = [];
		view.fetch = async (href) => {
			fetched.push(href);
			return { arrayBuffer: async () => new ArrayBuffer(4) };
		};

		registerPrefetchMapAssets(document);
		view.dispatchEvent(new view.Event('load'));
		await flushIdle();
		assert.equal(document.querySelectorAll('link[rel="prefetch"]').length, 0);
		assert.equal(fetched.length, 0);
	});
});
