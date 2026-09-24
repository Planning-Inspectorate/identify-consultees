import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { computeMapView } from './geometry-bounds.ts';

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
