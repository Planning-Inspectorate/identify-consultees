import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildDatasets } from './map-layers-demo.js';

describe('map-layers-demo buildDatasets', () => {
	test('creates four toggleable datasets when all overlays are present', () => {
		const datasets = buildDatasets({
			projectGeojson: { type: 'FeatureCollection', features: [{ type: 'Feature' }] },
			railwayGeojson: { type: 'FeatureCollection', features: [{ type: 'Feature' }] },
			roadGeojson: { type: 'FeatureCollection', features: [{ type: 'Feature' }] },
			constraintGeojson: { type: 'FeatureCollection', features: [{ type: 'Feature' }] },
			projectLayerLabel: 'Project site',
			railwayLayerLabel: 'Railway lines',
			roadLayerLabel: 'Road network',
			constraintLayerLabel: 'Flood risk area'
		});

		assert.equal(datasets.length, 4);
		assert.deepEqual(
			datasets.map((dataset) => dataset.id),
			['project-site', 'railways', 'roads', 'constraints']
		);
		for (const dataset of datasets) {
			assert.equal(dataset.showInMenu, true);
			assert.equal(dataset.showInKey, true);
		}
	});

	test('omits empty overlay collections', () => {
		const datasets = buildDatasets({
			projectGeojson: { type: 'FeatureCollection', features: [{ type: 'Feature' }] },
			railwayGeojson: { type: 'FeatureCollection', features: [] },
			roadGeojson: null,
			constraintGeojson: { type: 'FeatureCollection', features: [{ type: 'Feature' }] }
		});

		assert.deepEqual(
			datasets.map((dataset) => dataset.id),
			['project-site', 'constraints']
		);
	});
});
