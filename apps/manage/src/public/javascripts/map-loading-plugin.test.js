import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { createMapLoadingPlugin } from './map-loading-plugin.mjs';

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
const nextTask = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

describe('map-loading-plugin', () => {
	test('createMapLoadingPlugin wraps the container and covers it with an overlay', () => {
		const dom = installDom('<!DOCTYPE html><html><body><div id="map"></div></body></html>');
		const container = dom.window.document.getElementById('map');

		const plugin = createMapLoadingPlugin({ container });

		const wrapper = container.parentElement;
		assert.equal(wrapper.className, 'app-map-loading-wrap');
		const overlay = wrapper.querySelector('.app-map-loading');
		assert.ok(overlay);
		assert.equal(overlay.parentElement, wrapper);
		assert.equal(overlay.getAttribute('role'), 'status');
		assert.equal(overlay.querySelector('.app-map-loading__text').textContent, 'Loading map');
		assert.equal(overlay.querySelector('.app-map-loading__spinner').getAttribute('aria-hidden'), 'true');
		assert.equal(plugin.id, 'mapLoading');
		plugin.dismiss();
	});

	test('custom text replaces the default message', () => {
		const dom = installDom('<!DOCTYPE html><html><body><div id="map"></div></body></html>');
		const plugin = createMapLoadingPlugin({
			container: dom.window.document.getElementById('map'),
			text: 'Loading projects'
		});
		assert.equal(document.querySelector('.app-map-loading__text').textContent, 'Loading projects');
		plugin.dismiss();
	});

	test('a server-rendered overlay inside the container is adopted, not duplicated', () => {
		const dom = installDom(
			'<!DOCTYPE html><html><body><div id="map"><div class="app-map-loading" role="status"><span class="app-map-loading__text">Loading map</span></div><noscript>x</noscript></div></body></html>'
		);
		const container = dom.window.document.getElementById('map');
		const serverOverlay = container.querySelector('.app-map-loading');

		const plugin = createMapLoadingPlugin({ container });

		assert.equal(document.querySelectorAll('.app-map-loading').length, 1);
		// adopted markup moved out of the container it would otherwise be wiped from
		assert.equal(serverOverlay.parentElement, container.parentElement);
		assert.equal(container.contains(serverOverlay), false);
		plugin.dismiss();
	});

	test('an existing wrapper is reused rather than nested', () => {
		const dom = installDom(
			'<!DOCTYPE html><html><body><div class="app-map-loading-wrap"><div id="map"></div></div></body></html>'
		);
		const container = dom.window.document.getElementById('map');
		const wrapper = container.parentElement;

		const plugin = createMapLoadingPlugin({ container });

		assert.equal(document.querySelectorAll('.app-map-loading-wrap').length, 1);
		assert.equal(container.parentElement, wrapper);
		assert.ok(wrapper.querySelector('.app-map-loading'));
		plugin.dismiss();
	});

	test('a container without a parent still gets an overlay, inside it', () => {
		const dom = installDom();
		const container = dom.window.document.createElement('div');
		const plugin = createMapLoadingPlugin({ container });
		assert.ok(container.querySelector('.app-map-loading'));
		plugin.dismiss();
	});

	test('dismiss removes the overlay and is safe to call twice', () => {
		const dom = installDom('<!DOCTYPE html><html><body><div id="map"></div></body></html>');
		const plugin = createMapLoadingPlugin({ container: dom.window.document.getElementById('map') });

		plugin.dismiss();
		assert.equal(document.querySelector('.app-map-loading'), null);
		assert.doesNotThrow(() => plugin.dismiss());
	});

	test('the overlay is dismissed when the component renders its error markup', async () => {
		const dom = installDom('<!DOCTYPE html><html><body><div id="map"></div></body></html>');
		const container = dom.window.document.getElementById('map');
		const plugin = createMapLoadingPlugin({ container });

		container.innerHTML = '<div class="im-c-error">There was a problem loading the map.</div>';
		await nextTask();
		assert.equal(document.querySelector('.app-map-loading'), null);
		plugin.dismiss();
	});

	test('an .im-c-error already present at creation dismisses immediately', () => {
		const dom = installDom(
			'<!DOCTYPE html><html><body><div id="map"><div class="im-c-error">err</div></div></body></html>'
		);
		const plugin = createMapLoadingPlugin({ container: dom.window.document.getElementById('map') });
		assert.equal(document.querySelector('.app-map-loading'), null);
		plugin.dismiss();
	});

	test('the safety timeout dismisses a map that never reaches idle', async () => {
		const dom = installDom('<!DOCTYPE html><html><body><div id="map"></div></body></html>');
		const plugin = createMapLoadingPlugin({
			container: dom.window.document.getElementById('map'),
			timeoutMs: 5
		});
		assert.ok(document.querySelector('.app-map-loading'));
		await nextTask(30);
		assert.equal(document.querySelector('.app-map-loading'), null);
		plugin.dismiss();
	});

	test('a zero timeout leaves dismissal to the event and error paths', async () => {
		const dom = installDom('<!DOCTYPE html><html><body><div id="map"></div></body></html>');
		const plugin = createMapLoadingPlugin({
			container: dom.window.document.getElementById('map'),
			timeoutMs: 0
		});
		await nextTask(30);
		assert.ok(document.querySelector('.app-map-loading'));
		plugin.dismiss();
	});

	test('a plugin without a container has inert helpers', async () => {
		installDom();
		const plugin = createMapLoadingPlugin();
		assert.equal(plugin.id, 'mapLoading');
		assert.doesNotThrow(() => plugin.dismiss());
		assert.deepEqual(await plugin.load(), {});
	});

	test('load resolves an empty manifest - the overlay lives outside the app', async () => {
		const dom = installDom('<!DOCTYPE html><html><body><div id="map"></div></body></html>');
		const plugin = createMapLoadingPlugin({ container: dom.window.document.getElementById('map') });
		assert.deepEqual(await plugin.load(), {});
		plugin.dismiss();
	});

	test('mutations without an error marker leave the overlay alone', async () => {
		const dom = installDom('<!DOCTYPE html><html><body><div id="map"></div></body></html>');
		const container = dom.window.document.getElementById('map');
		const plugin = createMapLoadingPlugin({ container });

		container.innerHTML = '<div>still loading</div>';
		await nextTask();
		assert.ok(document.querySelector('.app-map-loading'));
		plugin.dismiss();
	});
});
