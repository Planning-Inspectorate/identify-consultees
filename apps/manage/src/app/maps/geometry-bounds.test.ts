import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { computeBounds, computeMapView } from './geometry-bounds.ts';

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
