import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import { injectLayersKeyTab } from './layers-key-slot.mjs';

const MAP_KEY_MANIFEST = {
	panels: [{ id: 'mapKey', render: function MapKey() {} }]
};

function mapKeyPlugin(manifest = MAP_KEY_MANIFEST) {
	return {
		noKeyItemText: 'No features displayed',
		load: mock.fn(async () => manifest)
	};
}

afterEach(() => {
	delete globalThis.preactCompat;
});

describe('injectLayersKeyTab', () => {
	test('does nothing without a map-key descriptor or preactCompat', async () => {
		const map = { addControl: mock.fn() };
		await injectLayersKeyTab(map, undefined);
		await injectLayersKeyTab(map, {});
		assert.equal(map.addControl.mock.callCount(), 0);

		// a descriptor exists but preactCompat does not - the chunk is never fetched
		globalThis.preactCompat = undefined;
		const plugin = mapKeyPlugin();
		await injectLayersKeyTab(map, plugin);
		assert.equal(plugin.load.mock.callCount(), 0);
		assert.equal(map.addControl.mock.callCount(), 0);
	});

	test('does nothing when the manifest has no mapKey panel', async () => {
		globalThis.preactCompat = { createElement: mock.fn() };
		const map = { addControl: mock.fn() };
		await injectLayersKeyTab(map, mapKeyPlugin({ panels: [] }));
		await injectLayersKeyTab(map, mapKeyPlugin({}));
		assert.equal(map.addControl.mock.callCount(), 0);
	});

	test('swallows a rejected load - the built-in menu still works', async () => {
		globalThis.preactCompat = { createElement: mock.fn() };
		const map = { addControl: mock.fn() };
		const plugin = { load: mock.fn(async () => Promise.reject(new Error('chunk missing'))) };
		await assert.doesNotReject(injectLayersKeyTab(map, plugin));
		assert.equal(map.addControl.mock.callCount(), 0);
	});

	test('injects the Key component as a tab control targeting the layers panel', async () => {
		const createElement = mock.fn(() => ({}));
		globalThis.preactCompat = { createElement };
		const map = { addControl: mock.fn() };
		const plugin = mapKeyPlugin();

		await injectLayersKeyTab(map, plugin);
		assert.equal(plugin.load.mock.callCount(), 1);
		assert.equal(map.addControl.mock.callCount(), 1);

		const [id, control] = map.addControl.mock.calls[0].arguments;
		assert.equal(id, 'layersKey');
		for (const breakpoint of ['mobile', 'tablet', 'desktop']) {
			assert.deepEqual(control[breakpoint], { slot: 'datasets-layers-panel', tab: 'Key' });
		}

		// the render wraps the map-key panel's own component, giving it the
		// pluginConfig props it would receive from its plugin
		control.render({ mapState: {} });
		assert.equal(createElement.mock.callCount(), 1);
		const [Component, props] = createElement.mock.calls[0].arguments;
		assert.equal(Component, MAP_KEY_MANIFEST.panels[0].render);
		assert.deepEqual(props, { mapState: {}, pluginConfig: plugin });
	});
});
