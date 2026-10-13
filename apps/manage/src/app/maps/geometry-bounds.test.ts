import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { computeBounds, computeFittedMapView, computeMapView } from './geometry-bounds.ts';

describe('computeMapView', () => {
	test('returns England/Wales fallback for an empty collection', () => {
		assert.deepEqual(computeMapView({ features: [] }), { center: [-2.5, 52.5], zoom: 6 });
	});

	test('fits a simple polygon', () => {
		const view = computeMapView({
			features: [
				{
					geometry: {
						type: 'Polygon',
						coordinates: [
							[
								[-1.8, 50.6],
								[-1.7, 50.6],
								[-1.7, 50.7],
								[-1.8, 50.7],
								[-1.8, 50.6]
							]
						]
					}
				}
			]
		});

		assert.equal(view.center[0], -1.75);
		assert.ok(Math.abs(view.center[1] - 50.65) < 1e-9);
		assert.ok(view.zoom >= 2 && view.zoom <= 18);
	});

	test('collects positions from a GeometryCollection', () => {
		const view = computeMapView({
			features: [
				{
					geometry: {
						type: 'GeometryCollection',
						geometries: [
							{ type: 'Point', coordinates: [-2, 52] },
							{ type: 'Point', coordinates: [-1, 53] }
						]
					}
				}
			]
		});

		assert.deepEqual(view.center, [-1.5, 52.5]);
	});

	test('ignores non-array coordinates', () => {
		assert.deepEqual(
			computeMapView({
				features: [{ geometry: { type: 'Point', coordinates: undefined } }]
			}),
			{ center: [-2.5, 52.5], zoom: 6 }
		);
	});
});

describe('computeBounds', () => {
	test('returns null when there is no geometry', () => {
		assert.equal(computeBounds({ features: [] }), null);
	});

	test('returns the bounding box of every feature', () => {
		assert.deepEqual(
			computeBounds({
				features: [
					{ geometry: { type: 'Point', coordinates: [-1, 52] } },
					{
						geometry: {
							type: 'LineString',
							coordinates: [
								[0.5, 51],
								[-2, 53]
							]
						}
					}
				]
			}),
			{ west: -2, south: 51, east: 0.5, north: 53 }
		);
	});

	test('handles geometries far too large to spread into Math.min', () => {
		const coordinates = Array.from({ length: 200_000 }, (_, i) => [i / 100_000, 50 + i / 100_000]);
		assert.deepEqual(computeBounds({ features: [{ geometry: { type: 'LineString', coordinates } }] }), {
			west: 0,
			south: 50,
			east: 1.99999,
			north: 51.99999
		});
	});
});

describe('computeFittedMapView', () => {
	const viewport = { width: 960, height: 516 };
	const square = (west: number, south: number, size: number) => ({
		features: [
			{
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[west, south],
							[west + size, south],
							[west + size, south + size],
							[west, south + size],
							[west, south]
						]
					]
				}
			}
		]
	});

	test('falls back to England and Wales with nothing to fit', () => {
		assert.deepEqual(computeFittedMapView({ features: [] }, viewport, { fill: 0.5, minExtentMetres: 5_000 }), {
			center: [-2.5, 52.5],
			zoom: 6
		});
	});

	test('fits the features into the map, filling at most the share asked for, at a whole zoom', () => {
		// 0.1 degree square: ~6.8km wide by ~11.1km tall at 52.5N - the height decides
		const site = square(-1.55, 52.45, 0.1);
		const half = computeFittedMapView(site, viewport, { fill: 0.5, minExtentMetres: 0 });
		assert.deepEqual(half.center, [-1.5, 52.5]);
		assert.equal(half.zoom, 11);
		// filling more of the map zooms in further
		assert.equal(computeFittedMapView(site, viewport, { fill: 1, minExtentMetres: 0 }).zoom, 12);
	});

	test('spans at least the minimum extent, so a small site is not shown at street level', () => {
		const point = { features: [{ geometry: { type: 'Point', coordinates: [-1.5, 52.5] } }] };
		assert.equal(computeFittedMapView(point, viewport, { fill: 0.5, minExtentMetres: 5_000 }).zoom, 12);
		assert.equal(computeFittedMapView(point, viewport, { fill: 0.5, minExtentMetres: 50_000 }).zoom, 8);
		// and never closer than the maps go
		assert.equal(computeFittedMapView(point, viewport, { fill: 0.5, minExtentMetres: 1 }).zoom, 18);
	});

	test('never zooms out further than the maps go', () => {
		assert.equal(computeFittedMapView(square(-170, -80, 160), viewport, { fill: 0.1, minExtentMetres: 0 }).zoom, 2);
	});
});
