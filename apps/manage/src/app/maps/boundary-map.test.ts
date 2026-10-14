import assert from 'node:assert';
import { describe, it } from 'node:test';
import { BOUNDARY_MAP_STYLES } from './boundary-map-styles.ts';
import { buildBoundaryMapConfig } from './boundary-map.ts';
import { MAP_VIEWPORT } from './sample-geojson.ts';

function boundaryFile(id: string, receivedDate: Date | null = null) {
	return {
		id,
		label: `${id}.geojson`,
		receivedDate,
		geometry: {
			type: 'Polygon' as const,
			coordinates: [
				[
					[-1.5000001, 52.5000001],
					[-1.4000001, 52.5000001],
					[-1.4000001, 52.6000001],
					[-1.5000001, 52.6000001],
					[-1.5000001, 52.5000001]
				]
			]
		}
	};
}

describe('buildBoundaryMapConfig', () => {
	it('should build one dataset per file, grouped under GIS shapefiles, framed on all of them', () => {
		const config = buildBoundaryMapConfig('Test Project', 'EN010099', [
			boundaryFile('first-file'),
			boundaryFile('second-file')
		]);

		assert.strictEqual(config.shapefileGroupLabel, 'GIS shapefiles');
		assert.strictEqual(config.shapefileDatasets.length, 2);

		const [first, second] = config.shapefileDatasets;
		assert.strictEqual(first.id, 'shapefile-first-file');
		assert.strictEqual(first.label, 'first-file.geojson');
		assert.strictEqual(second.id, 'shapefile-second-file');
		// each feature carries its file key so the client can filter/select it
		assert.strictEqual(first.geojson.features[0].properties.fileKey, 'first-file');
		assert.strictEqual(first.geojson.features[0].properties.reference, 'EN010099');
		// coordinates are rounded for display
		assert.strictEqual(first.geojson.features[0].geometry.coordinates[0][0][0], -1.5);

		assert.ok(Array.isArray(config.center));
		assert.strictEqual(config.width, MAP_VIEWPORT.width);
		assert.strictEqual(config.height, MAP_VIEWPORT.height);
		assert.match(config.mapLabel, /Test Project \(EN010099\)/);
	});

	it('should draw each file in its own style, the most recent red', () => {
		const config = buildBoundaryMapConfig('Test Project', 'EN010099', [
			boundaryFile('older', new Date('2025-11-01')),
			boundaryFile('newest', new Date('2026-04-01')),
			boundaryFile('undated')
		]);

		const [older, newest, undated] = config.shapefileDatasets.map((dataset) => dataset.style);
		assert.strictEqual(newest.stroke, BOUNDARY_MAP_STYLES.mostRecent.colour);
		assert.strictEqual(older.stroke, BOUNDARY_MAP_STYLES.earlier[0].colour);
		assert.strictEqual(undated.stroke, BOUNDARY_MAP_STYLES.earlier[1].colour);
		assert.strictEqual(new Set([older.stroke, newest.stroke, undated.stroke]).size, 3);
	});

	it('should round each member of a geometry collection', () => {
		const config = buildBoundaryMapConfig('Test Project', 'EN010099', [
			{
				...boundaryFile('collection-file'),
				geometry: {
					type: 'GeometryCollection' as const,
					geometries: [
						{ type: 'Point' as const, coordinates: [-1.5000001, 52.5000001] },
						{ type: 'Point' as const, coordinates: [-1.4000001, 52.6000001] }
					]
				}
			}
		]);

		assert.deepStrictEqual(config.shapefileDatasets[0].geojson.features[0].geometry, {
			type: 'GeometryCollection',
			geometries: [
				{ type: 'Point', coordinates: [-1.5, 52.5] },
				{ type: 'Point', coordinates: [-1.4, 52.6] }
			]
		});
	});

	it('should carry the static-map fallback when given one', () => {
		const config = buildBoundaryMapConfig('Test Project', 'EN010099', [boundaryFile('only-file')], {
			src: '/consultees/abc/boundary-map',
			alt: 'Static map'
		});
		assert.deepStrictEqual(config.fallback, {
			src: '/consultees/abc/boundary-map',
			alt: 'Static map',
			width: MAP_VIEWPORT.width,
			height: MAP_VIEWPORT.height
		});
	});
});
