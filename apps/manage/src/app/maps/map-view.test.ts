import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAP_VIEW, parseMapView } from './map-view.ts';

describe('map view config', () => {
	test('reads config/map-view.yaml', () => {
		assert.ok(MAP_VIEW.boundaryMapMarginMetres > 0);
	});

	test('turns the distance in km into metres', () => {
		assert.deepEqual(parseMapView('version: 1\nboundaryMapKm: 0.5\n'), { boundaryMapMarginMetres: 500 });
		assert.equal(parseMapView('version: 1\nboundaryMapKm: 0\n').boundaryMapMarginMetres, 0);
	});

	test('refuses a document that is not version 1, or a distance that is not 0 to 500km', () => {
		for (const text of ['', 'version: 2\nboundaryMapKm: 1', '[1, 2]']) {
			assert.throws(() => parseMapView(text), /map-view.yaml must be a version 1 document/);
		}
		for (const text of [
			'version: 1',
			'version: 1\nboundaryMapKm: -1',
			'version: 1\nboundaryMapKm: "1"',
			'version: 1\nboundaryMapKm: 501',
			'version: 1\nboundaryMapKm: .inf'
		]) {
			assert.throws(() => parseMapView(text), /map-view.yaml: boundaryMapKm must be a number of km from 0 to 500/);
		}
	});
});
