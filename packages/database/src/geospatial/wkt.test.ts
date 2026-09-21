import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Geometry, MultiPolygonGeometry, PolygonGeometry } from './wkt.ts';
import { geometryToWkt, wktToGeometry } from './wkt.ts';

describe('geometryToWkt', () => {
	test('converts a Point', () => {
		assert.equal(geometryToWkt({ type: 'Point', coordinates: [-0.1276, 51.5072] }), 'POINT(-0.1276 51.5072)');
	});

	test('converts a LineString', () => {
		const geometry: Geometry = {
			type: 'LineString',
			coordinates: [
				[0, 0],
				[1, 1]
			]
		};
		assert.equal(geometryToWkt(geometry), 'LINESTRING(0 0, 1 1)');
	});

	test('converts a Polygon with a correctly-wound exterior ring unchanged', () => {
		// counter-clockwise square
		const geometry: PolygonGeometry = {
			type: 'Polygon',
			coordinates: [
				[
					[0, 0],
					[1, 0],
					[1, 1],
					[0, 1],
					[0, 0]
				]
			]
		};
		assert.equal(geometryToWkt(geometry), 'POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))');
	});

	test('reverses a backwards-wound (clockwise) exterior ring', () => {
		// same square as above, but wound clockwise - must come out reversed
		const geometry: PolygonGeometry = {
			type: 'Polygon',
			coordinates: [
				[
					[0, 0],
					[0, 1],
					[1, 1],
					[1, 0],
					[0, 0]
				]
			]
		};
		assert.equal(geometryToWkt(geometry), 'POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))');
	});

	test('reverses a hole wound the wrong way (holes must be clockwise)', () => {
		const geometry: PolygonGeometry = {
			type: 'Polygon',
			coordinates: [
				[
					[0, 0],
					[10, 0],
					[10, 10],
					[0, 10],
					[0, 0]
				],
				// hole wound counter-clockwise - should be reversed to clockwise
				[
					[2, 2],
					[8, 2],
					[8, 8],
					[2, 8],
					[2, 2]
				]
			]
		};
		assert.equal(geometryToWkt(geometry), 'POLYGON((0 0, 10 0, 10 10, 0 10, 0 0), (2 2, 2 8, 8 8, 8 2, 2 2))');
	});

	test('converts a MultiPolygon', () => {
		const geometry: MultiPolygonGeometry = {
			type: 'MultiPolygon',
			coordinates: [
				[
					[
						[0, 0],
						[1, 0],
						[1, 1],
						[0, 1],
						[0, 0]
					]
				]
			]
		};
		assert.equal(geometryToWkt(geometry), 'MULTIPOLYGON(((0 0, 1 0, 1 1, 0 1, 0 0)))');
	});

	test('converts a GeometryCollection', () => {
		const geometry: Geometry = {
			type: 'GeometryCollection',
			geometries: [
				{ type: 'Point', coordinates: [0, 0] },
				{
					type: 'LineString',
					coordinates: [
						[0, 0],
						[1, 1]
					]
				}
			]
		};
		assert.equal(geometryToWkt(geometry), 'GEOMETRYCOLLECTION(POINT(0 0), LINESTRING(0 0, 1 1))');
	});
});

describe('wktToGeometry', () => {
	test('parses a Point', () => {
		assert.deepEqual(wktToGeometry('POINT(-0.1276 51.5072)'), { type: 'Point', coordinates: [-0.1276, 51.5072] });
	});

	test('round-trips a Polygon with a hole', () => {
		const geometry: PolygonGeometry = {
			type: 'Polygon',
			coordinates: [
				[
					[0, 0],
					[10, 0],
					[10, 10],
					[0, 10],
					[0, 0]
				],
				[
					[2, 2],
					[2, 8],
					[8, 8],
					[8, 2],
					[2, 2]
				]
			]
		};
		assert.deepEqual(wktToGeometry(geometryToWkt(geometry)), geometry);
	});

	test('round-trips a MultiPolygon', () => {
		const geometry: MultiPolygonGeometry = {
			type: 'MultiPolygon',
			coordinates: [
				[
					[
						[0, 0],
						[1, 0],
						[1, 1],
						[0, 1],
						[0, 0]
					]
				],
				[
					[
						[5, 5],
						[6, 5],
						[6, 6],
						[5, 6],
						[5, 5]
					]
				]
			]
		};
		assert.deepEqual(wktToGeometry(geometryToWkt(geometry)), geometry);
	});

	test('round-trips a GeometryCollection', () => {
		const geometry: Geometry = {
			type: 'GeometryCollection',
			geometries: [
				{ type: 'Point', coordinates: [0, 0] },
				{
					type: 'LineString',
					coordinates: [
						[0, 0],
						[1, 1]
					]
				}
			]
		};
		assert.deepEqual(wktToGeometry(geometryToWkt(geometry)), geometry);
	});

	test('throws on unrecognised WKT', () => {
		assert.throws(() => wktToGeometry('NOT WKT'), /Unrecognised WKT/);
	});
});
