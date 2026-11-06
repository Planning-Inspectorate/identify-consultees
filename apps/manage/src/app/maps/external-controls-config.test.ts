import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildExternalControlsConfig } from './external-controls-config.ts';
import { buildExternalControlsDemoFiles } from './external-controls-demo-geojson.ts';

describe('buildExternalControlsConfig', () => {
	test('emits one binding per file on the fileKey / shapefile-<id> convention', () => {
		const config = buildExternalControlsConfig([{ id: 'file-a' }, { id: 'file-b' }], {
			control: 'input[name="shapefile"]'
		});
		assert.equal(config.control, 'input[name="shapefile"]');
		assert.deepEqual(config.bindings, [
			{
				value: 'file-a',
				featureId: 'file-a',
				idProperty: 'fileKey',
				datasetId: 'shapefile-file-a',
				layerId: 'shapefile-file-a'
			},
			{
				value: 'file-b',
				featureId: 'file-b',
				idProperty: 'fileKey',
				datasetId: 'shapefile-file-b',
				layerId: 'shapefile-file-b'
			}
		]);
	});

	test('passes the behaviour options through and allows a different id convention', () => {
		const config = buildExternalControlsConfig([{ id: 'x' }], {
			control: '#f input',
			emphasis: 'dim',
			dimOpacity: 0.2,
			zoomTo: 'always',
			persistent: false,
			ensureVisible: false,
			primaryControl: 'external',
			idProperty: 'ref',
			datasetIdPrefix: 'file-'
		});
		assert.deepEqual(config.bindings[0], {
			value: 'x',
			featureId: 'x',
			idProperty: 'ref',
			datasetId: 'file-x',
			layerId: 'file-x'
		});
		assert.equal(config.emphasis, 'dim');
		assert.equal(config.dimOpacity, 0.2);
		assert.equal(config.zoomTo, 'always');
		assert.equal(config.persistent, false);
		assert.equal(config.ensureVisible, false);
		assert.equal(config.primaryControl, 'external');
	});

	test('defaults to an empty binding list and a JSON-safe shape', () => {
		const config = buildExternalControlsConfig([], { control: 'input' });
		assert.deepEqual(config.bindings, []);
		assert.deepEqual(JSON.parse(JSON.stringify(config)), config);
	});
});

describe('external-controls demo fixture', () => {
	test('three fictional overlapping files, newest first, matching the demo labels', () => {
		const files = buildExternalControlsDemoFiles();
		assert.equal(files.length, 3);
		assert.deepEqual(
			files.map((file) => file.id),
			['demo-cable-corridor', 'demo-red-line-boundary', 'demo-earlier-boundary']
		);
		assert.ok(files.every((file) => file.geometry.type === 'Polygon' && file.geometry.coordinates[0].length > 3));
		// the newest carries the received date the map styles rank on; the oldest has none
		assert.ok(files[0].receivedDate instanceof Date);
		assert.equal(files[2].receivedDate, null);
		assert.ok(files.every((file) => file.label.endsWith('.geojson')));
	});
});
