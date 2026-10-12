import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { createStaticMapPlugin, showStaticMapFallback } from './static-map-plugin.mjs';

function installDom(html = '<!DOCTYPE html><html><body></body></html>') {
	const dom = new JSDOM(html);
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.MutationObserver = dom.window.MutationObserver;
	return dom;
}

afterEach(() => {
	delete globalThis.window;
	delete globalThis.document;
	delete globalThis.HTMLElement;
	delete globalThis.MutationObserver;
});

/** MutationObserver callbacks deliver asynchronously — a macrotask is enough. */
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('static-map-plugin', () => {
	test('showStaticMapFallback ignores a missing container', () => {
		installDom();
		assert.doesNotThrow(() => showStaticMapFallback(undefined, { fallback: { src: '/s' } }));
		assert.doesNotThrow(() => showStaticMapFallback(null));
	});

	test('showStaticMapFallback inserts the image, hint and clears the interactive class', () => {
		const dom = installDom(
			'<!DOCTYPE html><html><body><div id="map" class="app-case-map-interactive"><noscript>x</noscript></div></body></html>'
		);
		const container = dom.window.document.getElementById('map');
		showStaticMapFallback(container, {
			fallback: { src: '/static.png', alt: 'Alt text', width: 320, height: 200 },
			hintText: 'A static map is shown instead.'
		});

		const img = container.querySelector('img.app-case-map-static');
		assert.equal(img.getAttribute('src'), '/static.png');
		assert.equal(img.getAttribute('alt'), 'Alt text');
		assert.equal(img.getAttribute('width'), '320');
		assert.equal(img.getAttribute('height'), '200');
		assert.equal(container.classList.contains('app-case-map-interactive'), false);
		assert.equal(container.childElementCount, 1);

		const hint = container.nextElementSibling;
		assert.equal(hint.className, 'govuk-body app-case-map-js-hint');
		assert.equal(hint.textContent, 'A static map is shown instead.');
	});

	test('showStaticMapFallback defaults alt, dimensions and hint text', () => {
		const dom = installDom('<!DOCTYPE html><html><body><div id="map"></div></body></html>');
		const container = dom.window.document.getElementById('map');
		showStaticMapFallback(container, { fallback: { src: '/s.png' } });

		const img = container.querySelector('img.app-case-map-static');
		assert.equal(img.getAttribute('alt'), '');
		assert.equal(img.getAttribute('width'), '960');
		assert.equal(img.getAttribute('height'), '516');
		assert.match(container.nextElementSibling.textContent, /static map of the same area/i);
	});

	test('showStaticMapFallback is idempotent once the image is present', () => {
		const dom = installDom('<!DOCTYPE html><html><body><div id="map"></div></body></html>');
		const container = dom.window.document.getElementById('map');
		showStaticMapFallback(container, { fallback: { src: '/s.png' } });
		container.nextElementSibling.remove();
		showStaticMapFallback(container, { fallback: { src: '/other.png' } });

		const images = container.querySelectorAll('img.app-case-map-static');
		assert.equal(images.length, 1);
		assert.equal(images[0].getAttribute('src'), '/s.png');
	});

	test('showStaticMapFallback reveals the hidden legend and tolerates a missing one', () => {
		const dom = installDom(
			'<!DOCTYPE html><html><body><div id="a"></div><div id="a-fallback" hidden><p>listed</p></div><div id="b"></div></body></html>'
		);
		showStaticMapFallback(dom.window.document.getElementById('a'), {
			fallback: { src: '/s' },
			revealId: 'a-fallback'
		});
		assert.equal(dom.window.document.getElementById('a-fallback').hidden, false);

		// a revealId pointing at nothing is a no-op, not an error
		assert.doesNotThrow(() => showStaticMapFallback(dom.window.document.getElementById('b'), { revealId: 'missing' }));
	});

	test('showStaticMapFallback writes the unavailable message when there is no src', () => {
		const dom = installDom(
			'<!DOCTYPE html><html><body><div id="a" class="app-case-map-interactive"><span>x</span></div><div id="b"></div></body></html>'
		);
		const a = dom.window.document.getElementById('a');
		showStaticMapFallback(a, { unavailableText: 'See the list below.' });
		const message = a.querySelector('p.govuk-body');
		assert.equal(message.textContent, 'See the list below.');
		assert.equal(a.classList.contains('app-case-map-interactive'), false);

		// no fallback at all and no configured text → the generic message
		const b = dom.window.document.getElementById('b');
		showStaticMapFallback(b, { fallback: {} });
		assert.match(b.querySelector('p.govuk-body').textContent, /could not load/i);
	});

	test('createStaticMapPlugin returns a descriptor carrying its config', async () => {
		const dom = installDom('<!DOCTYPE html><html><body><div id="map"></div></body></html>');
		const container = dom.window.document.getElementById('map');
		const fallback = { src: '/s.png', alt: 'a' };
		const plugin = createStaticMapPlugin({
			container,
			fallback,
			hintText: 'hint',
			unavailableText: 'unavailable',
			revealId: 'r'
		});

		assert.equal(plugin.id, 'staticMap');
		assert.equal(plugin.fallback, fallback);
		assert.equal(plugin.hintText, 'hint');
		assert.equal(plugin.unavailableText, 'unavailable');
		assert.equal(plugin.revealId, 'r');
		assert.deepEqual(await plugin.load(), {});
		plugin.stopWatching();
	});

	test("the descriptor's showFallback renders without a mounted map", () => {
		const dom = installDom('<!DOCTYPE html><html><body><div id="map"></div></body></html>');
		const plugin = createStaticMapPlugin({
			container: dom.window.document.getElementById('map'),
			fallback: { src: '/s.png' }
		});
		plugin.showFallback();
		assert.ok(dom.window.document.querySelector('#map img.app-case-map-static'));
		plugin.stopWatching();
	});

	test('the watcher swaps in the fallback when the component renders .im-c-error', async () => {
		const dom = installDom('<!DOCTYPE html><html><body><div id="map"></div></body></html>');
		const container = dom.window.document.getElementById('map');
		const plugin = createStaticMapPlugin({ container, fallback: { src: '/s.png' } });

		// what the component's renderError writes on an async loadApp failure
		container.innerHTML = '<div class="im-c-error">There was a problem loading the map.</div>';
		await nextTask();
		assert.ok(container.querySelector('img.app-case-map-static'));
		plugin.stopWatching();
	});

	test('an .im-c-error rendered before the plugin was created still falls back', () => {
		const dom = installDom(
			'<!DOCTYPE html><html><body><div id="map"><div class="im-c-error">err</div></div></body></html>'
		);
		const plugin = createStaticMapPlugin({
			container: dom.window.document.getElementById('map'),
			fallback: { src: '/s.png' }
		});
		assert.ok(dom.window.document.querySelector('#map img.app-case-map-static'));
		plugin.stopWatching();
	});

	test('stopWatching disconnects the observer', async () => {
		const dom = installDom('<!DOCTYPE html><html><body><div id="map"></div></body></html>');
		const container = dom.window.document.getElementById('map');
		const plugin = createStaticMapPlugin({ container, fallback: { src: '/s.png' } });
		plugin.stopWatching();

		container.innerHTML = '<div class="im-c-error">err</div>';
		await nextTask();
		assert.equal(container.querySelector('img.app-case-map-static'), null);
		assert.ok(container.querySelector('.im-c-error'));
	});

	test('a plugin without a container has inert helpers', async () => {
		installDom();
		const plugin = createStaticMapPlugin();
		assert.doesNotThrow(() => plugin.showFallback());
		assert.doesNotThrow(() => plugin.stopWatching());
		assert.deepEqual(await plugin.load(), {});
	});

	test('mutations without an error marker leave the container alone', async () => {
		const dom = installDom('<!DOCTYPE html><html><body><div id="map"></div></body></html>');
		const container = dom.window.document.getElementById('map');
		const plugin = createStaticMapPlugin({ container, fallback: { src: '/s.png' } });

		container.innerHTML = '<div>loading</div>';
		await nextTask();
		assert.equal(container.querySelector('img.app-case-map-static'), null);
		assert.match(container.textContent, /loading/);
		plugin.stopWatching();
	});
});
