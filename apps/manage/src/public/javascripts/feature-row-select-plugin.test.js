import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import {
	consulteeFeature,
	createFeatureRowSelectPlugin,
	filterMatches,
	layerForFeature,
	rowForConsultee,
	SELECTED_ROW_CLASS,
	syncRowFromSelection
} from './feature-row-select-plugin.mjs';

function installDom(html = '<!DOCTYPE html><html><body></body></html>') {
	const dom = new JSDOM(html);
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.HTMLElement = dom.window.HTMLElement;
	return dom;
}

afterEach(() => {
	delete globalThis.window;
	delete globalThis.document;
	delete globalThis.HTMLElement;
});

const TABLE_HTML = `<table class="pins-consultees-table"><tbody>
	<tr id="row-a"><td><input type="checkbox" data-consultee-id="a"></td><td>Alpha</td></tr>
	<tr id="row-b"><td><input type="checkbox" data-consultee-id="b"></td><td>Beta</td></tr>
	<tr id="row-c"><td><input type="checkbox"></td><td>Gamma</td></tr>
</tbody></table>`;

const consulteeDataset = (features, sublayers = []) => ({
	id: 'consultee-areas',
	geojson: { type: 'FeatureCollection', features },
	sublayers
});

const polygon = { type: 'Polygon', coordinates: [] };

function wireHarness({ datasets = [], table = TABLE_HTML } = {}) {
	installDom(`<!DOCTYPE html><html><body>${table}</body></html>`);
	const handlers = {};
	const map = {
		eventBus: { emit: mock.fn() },
		on: (event, handler) => {
			handlers[event] = handler;
		}
	};
	const interact = { clear: mock.fn() };
	const plugin = createFeatureRowSelectPlugin({ datasets });
	plugin.wire(map, interact);
	return { handlers, map, interact, plugin };
}

function click(element) {
	element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

describe('feature-row-select plugin', () => {
	test('is a plugin descriptor carrying its wire helper', async () => {
		const plugin = createFeatureRowSelectPlugin({ datasets: [] });
		assert.equal(plugin.id, 'featureRowSelect');
		assert.equal(typeof plugin.wire, 'function');
		assert.deepEqual(await plugin.load(), {});
	});

	test('consulteeFeature finds a consultee feature by its consulteeId, ids compared as strings', () => {
		const feature = { properties: { consulteeId: 7 }, geometry: polygon };
		const datasets = [
			{ id: 'project-site', geojson: { features: [{ properties: { consulteeId: 'a' } }] } },
			consulteeDataset([{ properties: {} }, feature])
		];
		assert.deepEqual(consulteeFeature(datasets, '7'), { dataset: datasets[1], feature });
		assert.equal(consulteeFeature(datasets, 'missing'), undefined);
		assert.equal(consulteeFeature([], '7'), undefined);
		assert.equal(consulteeFeature([{ id: 'consultee-areas' }], '7'), undefined);
	});

	test('filterMatches evaluates the sublayer expressions buildCategorySublayers emits', () => {
		const properties = { consulteeCategory: 'Parish Council', identified: 'true', consulteeId: 'a' };
		assert.equal(filterMatches(undefined, properties), true);
		assert.equal(filterMatches(['==', ['get', 'consulteeId'], 'a'], properties), true);
		assert.equal(filterMatches(['==', ['get', 'consulteeId'], 'b'], properties), false);
		assert.equal(filterMatches(['!=', ['get', 'identified'], 'false'], properties), true);
		assert.equal(filterMatches('literal', properties), true);
		assert.equal(
			filterMatches(
				['all', ['==', ['get', 'consulteeCategory'], 'Parish Council'], ['!=', ['get', 'identified'], 'false']],
				properties
			),
			true
		);
		assert.equal(
			filterMatches(
				['any', ['==', ['get', 'consulteeCategory'], 'Fire'], ['==', ['get', 'consulteeId'], 'a']],
				properties
			),
			true
		);
		assert.equal(filterMatches(['==', 'literal-left', 'literal-left'], properties), true);
		assert.equal(filterMatches(['in', ['get', 'consulteeId'], ['literal', ['a']]], properties), false);
	});

	test('layerForFeature names the matching sublayer - the layerId a map click records', () => {
		const dataset = consulteeDataset(
			[],
			[
				{
					id: 'identified-0',
					filter: [
						'all',
						['==', ['get', 'consulteeCategory'], 'Parish Council'],
						['!=', ['get', 'identified'], 'false']
					]
				},
				{ id: 'identified-1', filter: ['==', ['get', 'consulteeId'], 'own-1'] },
				{ id: 'identified-2', filter: ['==', ['get', 'consulteeCategory'], 'Police'] }
			]
		);
		const feature = { properties: { consulteeId: 'own-1', consulteeCategory: 'Parish Council' } };
		// the first filter also matches - sublayers run in draw order, first match wins
		assert.equal(layerForFeature({ dataset, feature }), 'consultee-areas-identified-0');
		const police = { properties: { consulteeId: 'p', consulteeCategory: 'Police' } };
		assert.equal(layerForFeature({ dataset, feature: police }), 'consultee-areas-identified-2');
		// a feature no sublayer filter matches falls back to the first (they share the source)
		assert.equal(layerForFeature({ dataset, feature: { properties: {} } }), 'consultee-areas-identified-0');
		// a dataset without sublayers is its own layer (the project site's convention)
		assert.equal(layerForFeature({ dataset: { id: 'project-site' }, feature }), 'project-site');
	});

	test('rowForConsultee finds the row through its checkbox and ignores id-less rows', () => {
		const dom = installDom(`<!DOCTYPE html><html><body>${TABLE_HTML}</body></html>`);
		const tbody = dom.window.document.querySelector('tbody');
		assert.equal(rowForConsultee(tbody, 'a')?.id, 'row-a');
		assert.equal(rowForConsultee(tbody, 2), undefined);
		assert.equal(rowForConsultee(tbody, 'gamma'), undefined);
		assert.equal(rowForConsultee(tbody, undefined), undefined);
	});

	test('syncRowFromSelection greys only the selected feature’s row and un-greys the rest', () => {
		const dom = installDom(`<!DOCTYPE html><html><body>${TABLE_HTML}</body></html>`);
		const tbody = dom.window.document.querySelector('tbody');
		syncRowFromSelection(tbody, [{ featureId: 'a' }]);
		assert.ok(dom.window.document.getElementById('row-a').classList.contains(SELECTED_ROW_CLASS));
		syncRowFromSelection(tbody, [{ featureId: 'b' }]);
		assert.equal(dom.window.document.getElementById('row-a').classList.contains(SELECTED_ROW_CLASS), false);
		assert.ok(dom.window.document.getElementById('row-b').classList.contains(SELECTED_ROW_CLASS));
		// a feature no row names - the project site, a nearby-only consultee - un-greys all
		syncRowFromSelection(tbody, [{ featureId: 'project' }]);
		assert.equal(tbody.querySelectorAll(`tr.${SELECTED_ROW_CLASS}`).length, 0);
		syncRowFromSelection(tbody, []);
		assert.equal(tbody.querySelectorAll(`tr.${SELECTED_ROW_CLASS}`).length, 0);
	});

	test('wire() no-ops when the page has no consultees table', () => {
		const { handlers, map } = wireHarness({ table: '<p>boundary page</p>' });
		assert.deepEqual(handlers, {});
		assert.equal(map.eventBus.emit.mock.callCount(), 0);
	});

	test('a row click emits a full interact:selectFeature for its consultee once interact is active', () => {
		const feature = {
			properties: { consulteeId: 'a', name: 'Alpha', consulteeCategory: 'Parish Council', identified: 'true' },
			geometry: polygon
		};
		const datasets = [
			consulteeDataset(
				[feature],
				[
					{
						id: 'identified-0',
						filter: [
							'all',
							['==', ['get', 'consulteeCategory'], 'Parish Council'],
							['!=', ['get', 'identified'], 'false']
						]
					}
				]
			)
		];
		const { handlers, map } = wireHarness({ datasets });
		handlers['interact:active']({ active: true });

		click(document.querySelector('#row-a td:last-child'));
		assert.deepEqual(map.eventBus.emit.mock.calls[0].arguments, [
			'interact:selectFeature',
			{
				featureId: 'a',
				layerId: 'consultee-areas-identified-0',
				idProperty: 'consulteeId',
				properties: feature.properties,
				geometry: polygon
			}
		]);
	});

	test('a row click before interact is active is replayed on interact:active', () => {
		const feature = { properties: { consulteeId: 'b', consulteeCategory: 'Parish Council' }, geometry: polygon };
		const datasets = [consulteeDataset([feature], [{ id: 'identified-0', filter: undefined }])];
		const { handlers, map } = wireHarness({ datasets });

		click(document.querySelector('#row-b td:last-child'));
		assert.equal(map.eventBus.emit.mock.callCount(), 0);
		handlers['interact:active']({ active: true });
		assert.equal(map.eventBus.emit.mock.callCount(), 1);
		assert.equal(map.eventBus.emit.mock.calls[0].arguments[1].featureId, 'b');
	});

	test('a row click for a consultee with no mapped feature emits nothing', () => {
		const { handlers, map } = wireHarness({ datasets: [consulteeDataset([])] });
		handlers['interact:active']({ active: true });
		click(document.querySelector('#row-a td:last-child'));
		assert.equal(map.eventBus.emit.mock.callCount(), 0);
	});

	test('clicks on the row’s controls do their own job, and id-less rows do nothing', () => {
		const { handlers, map } = wireHarness({
			datasets: [consulteeDataset([{ properties: { consulteeId: 'a' }, geometry: polygon }])]
		});
		handlers['interact:active']({ active: true });
		click(document.querySelector('#row-a input')); // the bulk-removal checkbox
		assert.equal(map.eventBus.emit.mock.callCount(), 0);
		click(document.querySelector('#row-c td:last-child')); // a name-only add: nothing on the map
		assert.equal(map.eventBus.emit.mock.callCount(), 0);
	});

	test('clicking the selected row deselects it, like clicking the feature again', () => {
		const { handlers, interact } = wireHarness({ datasets: [] });
		handlers['interact:active']({ active: true });
		handlers['interact:selectionchange']({ selectedFeatures: [{ featureId: 'a' }] });
		click(document.querySelector('#row-a td:last-child'));
		assert.equal(interact.clear.mock.callCount(), 1);
		// and the deselect confirmed by an empty selectionchange leaves the row plain
		handlers['interact:selectionchange']({ selectedFeatures: [] });
		assert.equal(document.querySelector('#row-a').classList.contains(SELECTED_ROW_CLASS), false);
	});

	test('interact reporting inactive holds row selects until it activates, and odd events are tolerated', () => {
		const feature = { properties: { consulteeId: 'a' }, geometry: polygon };
		const { handlers, map } = wireHarness({ datasets: [consulteeDataset([feature])] });
		handlers['interact:active']({ active: false });
		click(document.querySelector('#row-a td:last-child'));
		assert.equal(map.eventBus.emit.mock.callCount(), 0);
		// it replays once interact activates
		handlers['interact:active']({ active: true });
		assert.equal(map.eventBus.emit.mock.callCount(), 1);

		// a selectionchange with no payload, and a click on the tbody itself, are ignored
		handlers['interact:selectionchange']({});
		assert.equal(document.querySelectorAll(`tr.${SELECTED_ROW_CLASS}`).length, 0);
		click(document.querySelector('tbody'));
	});

	test('a map selection greys the matching row; a second row click selects without re-emitting the same one', () => {
		const feature = { properties: { consulteeId: 'b' }, geometry: polygon };
		const { handlers, map } = wireHarness({ datasets: [consulteeDataset([feature])] });
		handlers['interact:active']({ active: true });

		handlers['interact:selectionchange']({ selectedFeatures: [{ featureId: 'a', layerId: 'x' }] });
		assert.ok(document.querySelector('#row-a').classList.contains(SELECTED_ROW_CLASS));

		// the map already selected 'a' - clicking its row again deselects rather than emitting
		click(document.querySelector('#row-a td:last-child'));
		assert.equal(map.eventBus.emit.mock.callCount(), 0);

		// while 'b' selects on first click
		click(document.querySelector('#row-b td:last-child'));
		assert.equal(map.eventBus.emit.mock.callCount(), 1);
	});
});
