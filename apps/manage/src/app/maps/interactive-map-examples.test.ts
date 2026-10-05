import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getInteractiveMapExample, INTERACTIVE_MAP_EXAMPLES } from './interactive-map-examples.ts';

describe('interactive map example registry', () => {
	test('every example has a unique id matching its client config kind', () => {
		const ids = INTERACTIVE_MAP_EXAMPLES.map((example) => example.id);
		assert.equal(new Set(ids).size, ids.length);
		for (const example of INTERACTIVE_MAP_EXAMPLES) {
			assert.equal(example.clientConfig.kind, example.id);
		}
	});

	test('every example has accessible text for the page and the static fallback', () => {
		for (const example of INTERACTIVE_MAP_EXAMPLES) {
			assert.ok(example.title.length > 0, example.id);
			assert.ok(example.summary.length > 0, example.id);
			assert.ok(example.interaction.length > 0, example.id);
			assert.ok(example.clientConfig.mapLabel.length > 0, example.id);
			assert.ok(example.staticMap.alt.length > 0, example.id);
			assert.ok(Number.isFinite(example.clientConfig.zoom), example.id);
		}
	});

	test('plugin lists only contain known plugin ids', () => {
		const known = new Set(['datasets', 'map-key', 'interact', 'draw', 'map-styles']);
		for (const example of INTERACTIVE_MAP_EXAMPLES) {
			for (const plugin of example.plugins) {
				assert.ok(known.has(plugin), `${example.id}: ${plugin}`);
			}
		}
	});

	test('getInteractiveMapExample resolves by id and misses unknown ids', () => {
		assert.equal(getInteractiveMapExample('basic')?.title, 'Basic map');
		assert.equal(getInteractiveMapExample('style-switcher')?.id, 'style-switcher');
		assert.equal(getInteractiveMapExample('missing'), undefined);
	});

	test('every style-switcher option ships a data-uri thumbnail', () => {
		const example = getInteractiveMapExample('style-switcher');
		for (const style of example?.clientConfig.mapStyles ?? []) {
			assert.match(String(style.thumbnail), /^data:image\/svg\+xml,/, String(style.id));
		}
	});
});
