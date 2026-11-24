import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import {
	duringIdleTime,
	injectPrefetchLinks,
	prefetchTemplate,
	registerPrefetchMapAssets,
	supportsLinkPrefetch,
	warmCacheWithFetch
} from './prefetch-map-assets.js';

function documentWith(body = '') {
	const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${body}</body></html>`);
	return dom.window.document;
}

const ISLAND = `<template id="prefetch-map-assets-data">
	<link rel="prefetch" href="/vendor/interactive-map/js/index-a1b2c3d4.js" as="script" fetchpriority="low">
	<link rel="prefetch" href="/vendor/interactive-map/css/index-e5f6a7b8.css" as="style" fetchpriority="low">
</template>`;

/** Let a pending duringIdleTime setTimeout callback run. */
const flushIdle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('prefetchTemplate', () => {
	test('finds the page island', () => {
		const document = documentWith(ISLAND);
		const template = prefetchTemplate(document);
		assert.equal(template.tagName, 'TEMPLATE');
		assert.equal(template.content.querySelectorAll('link[rel="prefetch"]').length, 2);
	});

	test('is undefined without an island, or for a document that has none', () => {
		assert.equal(prefetchTemplate(documentWith()), undefined);
		assert.equal(prefetchTemplate(undefined), undefined);
	});

	test('is undefined when the island element is not a template', () => {
		const document = documentWith(`<script id="prefetch-map-assets-data" type="application/json">[]</script>`);
		assert.equal(prefetchTemplate(document), undefined);
	});
});

describe('supportsLinkPrefetch', () => {
	test('is false where link.relList knows no prefetch (jsdom, Safari-like)', () => {
		assert.equal(supportsLinkPrefetch(documentWith()), false);
	});
});

describe('injectPrefetchLinks', () => {
	test('adopts the island links into head, attributes untouched', () => {
		const document = documentWith(ISLAND);
		const template = prefetchTemplate(document);
		injectPrefetchLinks(template, document);
		const links = document.head.querySelectorAll('link[rel="prefetch"]');
		assert.equal(links.length, 2);
		assert.equal(links[0].getAttribute('href'), '/vendor/interactive-map/js/index-a1b2c3d4.js');
		assert.equal(links[0].getAttribute('as'), 'script');
		assert.equal(links[0].getAttribute('fetchpriority'), 'low');
		assert.equal(links[1].getAttribute('as'), 'style');
		// the template keeps its own content - a second prime adopts another copy
		assert.equal(template.content.querySelectorAll('link').length, 2);
	});
});

describe('warmCacheWithFetch', () => {
	test('fetches every island href at low priority and consumes the body so it caches', async () => {
		const document = documentWith(ISLAND);
		const fetched = [];
		const view = {
			fetch: async (href, init) => {
				fetched.push({ href, init });
				return { arrayBuffer: async () => new ArrayBuffer(4) };
			}
		};
		await warmCacheWithFetch(prefetchTemplate(document), view);
		assert.deepStrictEqual(fetched, [
			{ href: '/vendor/interactive-map/js/index-a1b2c3d4.js', init: { priority: 'low' } },
			{ href: '/vendor/interactive-map/css/index-e5f6a7b8.css', init: { priority: 'low' } }
		]);
	});

	test('a failed prime is swallowed, not thrown', async () => {
		const document = documentWith(ISLAND);
		const view = {
			fetch: async () => {
				throw new Error('network down');
			}
		};
		await assert.doesNotReject(() => warmCacheWithFetch(prefetchTemplate(document), view));
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

	test('after load, idle time adopts the island links into head', async () => {
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
		assert.equal(document.head.querySelectorAll('link[rel="prefetch"]').length, 0);
		view.dispatchEvent(new view.Event('load'));
		await flushIdle();

		const links = document.head.querySelectorAll('link[rel="prefetch"]');
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

	test('a page with no island primes nothing', async () => {
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
		assert.equal(document.head.querySelectorAll('link[rel="prefetch"]').length, 0);
		assert.equal(fetched.length, 0);
	});
});
