import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAP_VIEW, parseMapView } from './map-view.ts';

describe('map view config', () => {
	test('reads config/map-view.yaml', () => {
		assert.ok(MAP_VIEW.consulteeMapsMarginMetres > 0);
		assert.ok(MAP_VIEW.boundaryMapMarginMetres > 0);
	});

	test('turns each distance in km into metres', () => {
		assert.deepEqual(parseMapView('version: 1\nconsulteeMapsKm: 10\nboundaryMapKm: 0.5\n'), {
			consulteeMapsMarginMetres: 10_000,
			boundaryMapMarginMetres: 500
		});
		assert.equal(parseMapView('version: 1\nconsulteeMapsKm: 0\nboundaryMapKm: 500\n').consulteeMapsMarginMetres, 0);
	});

	test('refuses a document that is not version 1, or a distance that is not 0 to 500km', () => {
		for (const text of ['', 'version: 2\nconsulteeMapsKm: 1\nboundaryMapKm: 1', '[1, 2]']) {
			assert.throws(() => parseMapView(text), /map-view.yaml must be a version 1 document/);
		}
		for (const [text, name] of [
			['version: 1\nboundaryMapKm: 1', 'consulteeMapsKm'],
			['version: 1\nconsulteeMapsKm: -1\nboundaryMapKm: 1', 'consulteeMapsKm'],
			['version: 1\nconsulteeMapsKm: "10"\nboundaryMapKm: 1', 'consulteeMapsKm'],
			['version: 1\nconsulteeMapsKm: 1\nboundaryMapKm: 501', 'boundaryMapKm'],
			['version: 1\nconsulteeMapsKm: .inf\nboundaryMapKm: 1', 'consulteeMapsKm']
		]) {
			assert.throws(
				() => parseMapView(text),
				new RegExp(`map-view.yaml: ${name} must be a number of km from 0 to 500`)
			);
		}
	});
});
