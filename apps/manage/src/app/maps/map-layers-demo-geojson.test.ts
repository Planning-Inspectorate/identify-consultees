import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	buildConstraintAreaGeojson,
	buildMapLayersDemoCollections,
	buildRailwayGeojson,
	buildRoadNetworkGeojson
} from './map-layers-demo-geojson.ts';

describe('map layers demo geojson', () => {
	test('builds railway LineString features', () => {
		const geojson = buildRailwayGeojson();
		assert.equal(geojson.type, 'FeatureCollection');
		assert.ok(geojson.features.length >= 1);
		assert.equal(geojson.features[0].geometry.type, 'LineString');
	});

	test('builds road network LineString features', () => {
		const geojson = buildRoadNetworkGeojson();
		assert.equal(geojson.features[0].geometry.type, 'LineString');
	});

	test('builds constraint polygon features', () => {
		const geojson = buildConstraintAreaGeojson();
		assert.equal(geojson.features[0].geometry.type, 'Polygon');
	});

	test('demo collections include a usable map view', () => {
		const { mapView, projectGeojson, railwayGeojson, roadGeojson, constraintGeojson } = buildMapLayersDemoCollections();
		assert.ok(Number.isFinite(mapView.center[0]));
		assert.ok(Number.isFinite(mapView.center[1]));
		assert.ok(mapView.zoom >= 2);
		assert.ok(projectGeojson.features.length > 0);
		assert.ok(railwayGeojson.features.length > 0);
		assert.ok(roadGeojson.features.length > 0);
		assert.ok(constraintGeojson.features.length > 0);
	});
});
