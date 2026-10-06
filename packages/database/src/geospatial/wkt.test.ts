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

	test('leaves collinear sliver holes as given, rather than "correcting" them on rounding noise', () => {
		// real sliver holes from a case boundary (EN010055) that SQL Server stores as valid: three
		// points collinear to within double precision, so their winding is meaningless - reversing
		// one on a rounding-noise sign made SQL Server reject the whole polygon (error 24144)
		const slivers: [number, number][][] = [
			[
				[-2.904756675435801, 53.04959200849621],
				[-2.904734027849014, 53.049555208820664],
				[-2.9047235956832913, 53.0495382577497],
				[-2.904756675435801, 53.04959200849621]
			],
			[
				[-2.903968565178488, 53.04595246062132],
				[-2.9029229915130634, 53.04596118342676],
				[-2.90292622971762, 53.04596115642559],
				[-2.903968565178488, 53.04595246062132]
			]
		];
		const exterior: [number, number][] = [
			[-2.91, 53.04],
			[-2.9, 53.04],
			[-2.9, 53.05],
			[-2.91, 53.05],
			[-2.91, 53.04]
		];
		const wkt = geometryToWkt({ type: 'Polygon', coordinates: [exterior, ...slivers] });
		for (const sliver of slivers) {
			assert.ok(wkt.includes(sliver.map(([lon, lat]) => `${lon} ${lat}`).join(', ')), 'expected the sliver unreversed');
		}
	});

	test('orients a small but real hole correctly, despite large lon/lat values', () => {
		// a real (0.3 m^2, non-collinear) hole near 53N - its area is tiny next to lon*lat products of
		// ~150, the precision the old raw-coordinate calculation lost
		const exterior: [number, number][] = [
			[-2.914, 53.029],
			[-2.912, 53.029],
			[-2.912, 53.031],
			[-2.914, 53.031],
			[-2.914, 53.029]
		];
		const hole: [number, number][] = [
			[-2.913342572524452, 53.03007963713935],
			[-2.913124361086929, 53.03008594404369],
			[-2.9130339446128732, 53.030088120813176],
			[-2.913342572524452, 53.03007963713935]
		];
		const wkt = geometryToWkt({ type: 'Polygon', coordinates: [exterior, [...hole].reverse()] });
		// given counter-clockwise, it comes back clockwise, as SQL Server requires of a hole
		assert.ok(wkt.includes(hole.map(([lon, lat]) => `${lon} ${lat}`).join(', ')));
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
