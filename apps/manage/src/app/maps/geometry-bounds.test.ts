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

	test('fits at the exact zoom when asked - between whole ones, filling the map', () => {
		const whole = computeFittedMapView(square(-1.5, 52.5, 0.1), viewport, 0);
		const exact = computeFittedMapView(square(-1.5, 52.5, 0.1), viewport, 0, { wholeZoom: false });
		assert.deepEqual(exact.center, whole.center);
		assert.ok(exact.zoom > whole.zoom && exact.zoom < whole.zoom + 1, String(exact.zoom));
	});

	test('falls back to England and Wales with nothing to fit', () => {
		assert.deepEqual(computeFittedMapView({ features: [] }, viewport, 10_000), { center: [-2.5, 52.5], zoom: 6 });
	});

	test('fits the features, centred, at the closest whole zoom that shows them', () => {
		// 0.1 degree square: ~6.8km wide by ~11.1km tall at 52.5N - the map's height decides
		const site = square(-1.55, 52.45, 0.1);
		const view = computeFittedMapView(site, viewport, 0);
		assert.deepEqual(view.center, [-1.5, 52.5]);
		assert.equal(view.zoom, 12);
	});

	test('keeps at least the margin around the features on every side', () => {
		const point = { features: [{ geometry: { type: 'Point', coordinates: [-1.5, 52.5] } }] };
		// 10km either side is 20km down the 516px map - about 39m a pixel, so zoom 11 (~46m)
		assert.equal(computeFittedMapView(point, viewport, 10_000).zoom, 11);
		assert.equal(computeFittedMapView(point, viewport, 5_000).zoom, 12);
		assert.equal(computeFittedMapView(point, viewport, 500).zoom, 15);
		assert.equal(computeFittedMapView(square(-1.55, 52.45, 0.1), viewport, 10_000).zoom, 10);
		// no margin round a point - as close as the maps go
		assert.equal(computeFittedMapView(point, viewport, 0).zoom, 18);
	});

	test('never zooms out further than the maps go', () => {
		assert.equal(computeFittedMapView(square(-170, -80, 160), viewport, 0).zoom, 2);
	});
});
