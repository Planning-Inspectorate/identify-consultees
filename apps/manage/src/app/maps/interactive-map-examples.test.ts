import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getInteractiveMapExample, INTERACTIVE_MAP_EXAMPLES, numberedBadges } from './interactive-map-examples.ts';

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

	test('examples with feature content ship badges and a legend for the static fallback', () => {
		const select = getInteractiveMapExample('select-feature');
		assert.equal(select?.staticMap.featureBadges?.length, 7);
		assert.deepEqual(select?.staticMap.legend?.columns, ['Number', 'Name', 'Land use']);
		assert.equal(select?.staticMap.legend?.rows[0]?.[0], '1');
		// badge numbers must match legend row order
		assert.deepEqual(
			select?.staticMap.featureBadges?.map((badge) => badge.label),
			select?.staticMap.legend?.rows.map((row) => row[0])
		);

		const symbols = getInteractiveMapExample('symbols');
		assert.equal(symbols?.staticMap.featureBadges?.length, 3);
		assert.equal(symbols?.staticMap.featureBadges?.[0]?.fill, '#00897B');
		assert.equal(symbols?.staticMap.legend?.rows.length, 3);

		for (const id of ['marker-panel', 'marker-label'] as const) {
			const example = getInteractiveMapExample(id);
			assert.equal(example?.staticMap.markers?.length, 1, id);
			assert.ok(example?.staticMap.legend?.rows.length, id);
		}
	});

	test('numberedBadges skips features whose geometry has no centroid', () => {
		const badges = numberedBadges([
			{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[]] }, properties: {} },
			{ type: 'Feature', geometry: { type: 'Point', coordinates: [-1, 50] }, properties: {} }
		]);
		assert.equal(badges.length, 1);
		assert.equal(badges[0]?.label, '2');
	});
});
