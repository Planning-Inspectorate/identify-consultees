import assert from 'node:assert';
import { describe, it } from 'node:test';
import type { BoundaryFileStyle } from './boundary-map-styles.ts';
import { buildBoundaryMapConfig } from './boundary-map.ts';
import { MAP_VIEWPORT } from './sample-geojson.ts';

import type { BoundaryFileOption } from '../views/consultees/project/boundary-files.ts';
import { BOUNDARY_MAP_STYLES } from './boundary-map-styles.ts';
import { boundaryFileStyle } from './boundary-map.ts';

function boundaryFile(id: string, receivedDate: Date | null = null) {
	return {
		id,
		label: `${id}.geojson`,
		receivedDate,
		geometry: {
			type: 'Polygon' as const,
			coordinates: [
				[
					[-1.5000001, 52.5000001] as [number, number],
					[-1.4000001, 52.5000001] as [number, number],
					[-1.4000001, 52.6000001] as [number, number],
					[-1.5000001, 52.6000001] as [number, number],
					[-1.5000001, 52.5000001] as [number, number]
				]
			]
		}
	};
}

function generateStyles(count: number) {
	const styles: BoundaryFileStyle[] = [
		{
			colour: '#ff0000',
			fillOpacity: 0.2,
			strokeWidth: 1.5,
			description: 'red, solid fill'
		},
		{
			colour: '#00ff00',
			fillOpacity: 0.2,
			strokeWidth: 1.5,
			description: 'green, solid fill'
		},
		{
			colour: '#0000ff',
			fillOpacity: 0.2,
			strokeWidth: 1.5,
			description: 'blue, solid fill'
		}
	];

	return styles.slice(0, count);
}

describe('buildBoundaryMapConfig', () => {
	it('should build one dataset per file, grouped under GIS shapefiles, framed on all of them', () => {
		const config = buildBoundaryMapConfig(
			'Test Project',
			'EN010099',
			[boundaryFile('first-file'), boundaryFile('second-file')],
			generateStyles(2)
		);

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

	it('should use the provided styles to generate the correct dataset styles', () => {
		const styles = generateStyles(3);
		const config = buildBoundaryMapConfig(
			'Test Project',
			'EN010099',
			[
				boundaryFile('older', new Date('2025-11-01')),
				boundaryFile('newest', new Date('2026-04-01')),
				boundaryFile('undated')
			],
			styles
		);

		const [older, newest, undated] = config.shapefileDatasets.map((dataset) => dataset.style);
		assert.strictEqual(older.stroke, styles[0].colour);
		assert.strictEqual(newest.stroke, styles[1].colour);
		assert.strictEqual(undated.stroke, styles[2].colour);
		assert.notStrictEqual(newest.stroke, older.stroke);
	});

	it('should round each member of a geometry collection', () => {
		const config = buildBoundaryMapConfig(
			'Test Project',
			'EN010099',
			[
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
			],
			generateStyles(2)
		);

		assert.deepStrictEqual(config.shapefileDatasets[0].geojson.features[0].geometry, {
			type: 'GeometryCollection',
			geometries: [
				{ type: 'Point', coordinates: [-1.5, 52.5] },
				{ type: 'Point', coordinates: [-1.4, 52.6] }
			]
		});
	});

	it('should carry the static-map fallback when given one', () => {
		const config = buildBoundaryMapConfig('Test Project', 'EN010099', [boundaryFile('only-file')], generateStyles(1), {
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

function boundaryFileOption(id: string, receivedDate: Date | null = null, current = false): BoundaryFileOption {
	return {
		id,
		label: `${id}.geojson`,
		receivedDate,
		current
	};
}

describe('boundaryFileStyle', () => {
	it('should return an empty array when there are no files', () => {
		assert.deepStrictEqual(boundaryFileStyle([]), []);
	});

	it('should assign the mostRecent style to a single file even when undated', () => {
		assert.deepStrictEqual(boundaryFileStyle([boundaryFileOption('only-file', null)]), [
			BOUNDARY_MAP_STYLES.mostRecent
		]);
	});

	it('should assign mostRecent to the newest file and earlier styles by descending date regardless of input order or current flag', () => {
		const styles = boundaryFileStyle([
			boundaryFileOption('older', new Date('2025-11-01'), true),
			boundaryFileOption('newest', new Date('2026-04-01'), false)
		]);

		assert.deepStrictEqual(styles, [BOUNDARY_MAP_STYLES.earlier[0], BOUNDARY_MAP_STYLES.mostRecent]);
	});

	it('should treat undated files as oldest, after all dated files', () => {
		const styles = boundaryFileStyle([
			boundaryFileOption('undated', null),
			boundaryFileOption('newest', new Date('2026-04-01')),
			boundaryFileOption('middle', new Date('2025-11-01'))
		]);

		assert.deepStrictEqual(styles, [
			BOUNDARY_MAP_STYLES.earlier[1 % BOUNDARY_MAP_STYLES.earlier.length],
			BOUNDARY_MAP_STYLES.mostRecent,
			BOUNDARY_MAP_STYLES.earlier[0]
		]);
	});

	it('should preserve input order when received dates tie', () => {
		const sharedDate = new Date('2026-04-01T12:00:00Z');
		const styles = boundaryFileStyle([
			boundaryFileOption('first-tie', sharedDate),
			boundaryFileOption('second-tie', sharedDate)
		]);

		assert.deepStrictEqual(styles, [BOUNDARY_MAP_STYLES.mostRecent, BOUNDARY_MAP_STYLES.earlier[0]]);
	});

	it('should cycle through the earlier styles when there are more files than earlier entries', () => {
		const fileCount = BOUNDARY_MAP_STYLES.earlier.length + 1;
		const files = Array.from({ length: fileCount }, (_, index) =>
			boundaryFileOption(`file-${index}`, new Date(Date.UTC(2026, 3, fileCount - index)))
		);

		const styles = boundaryFileStyle(files);

		assert.deepStrictEqual(styles[0], BOUNDARY_MAP_STYLES.mostRecent);
		assert.deepStrictEqual(styles[1], BOUNDARY_MAP_STYLES.earlier[0]);
		assert.deepStrictEqual(styles[fileCount - 1], BOUNDARY_MAP_STYLES.earlier[0]);
	});
});
