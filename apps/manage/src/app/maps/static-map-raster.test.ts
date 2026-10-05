import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { GeoJsonFeatureCollection } from './sample-geojson.ts';
import { negotiateStaticMapFormat, renderStaticMapRaster, STATIC_MAP_CONTENT_TYPES } from './static-map-raster.ts';

const tinyPng = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

const emptyCollection: GeoJsonFeatureCollection = { type: 'FeatureCollection', features: [] };

const square: GeoJsonFeatureCollection = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			properties: { name: 'site' },
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
};

const baseOptions = {
	center: [-1.75, 50.65] as const,
	zoom: 10,
	projectGeojson: square,
	consulteeGeojson: square,
	width: 256,
	height: 256
};

describe('negotiateStaticMapFormat', () => {
	test('prefers the smallest accepted format', () => {
		assert.equal(negotiateStaticMapFormat('image/avif,image/webp,image/apng,image/*,*/*;q=0.8'), 'avif');
		assert.equal(negotiateStaticMapFormat('image/webp,image/png,image/svg+xml,*/*;q=0.8'), 'webp');
		assert.equal(negotiateStaticMapFormat('image/png,image/svg+xml,*/*;q=0.8'), 'png');
	});

	test('falls back to png for wildcards, missing and odd headers', () => {
		assert.equal(negotiateStaticMapFormat(undefined), 'png');
		assert.equal(negotiateStaticMapFormat(''), 'png');
		assert.equal(negotiateStaticMapFormat('*/*'), 'png');
		assert.equal(negotiateStaticMapFormat('text/html'), 'png');
		assert.equal(negotiateStaticMapFormat('image/svg+xml'), 'png');
	});

	test('honours q=0 exclusions', () => {
		assert.equal(negotiateStaticMapFormat('image/avif;q=0,image/webp,*/*;q=0.8'), 'webp');
		assert.equal(negotiateStaticMapFormat('image/avif;q=0,image/webp;q=0,*/*;q=0.8'), 'png');
	});
});

describe('renderStaticMapRaster', () => {
	test('encodes png with a real basemap tile and overlay', async () => {
		const body = await renderStaticMapRaster(baseOptions, 'png', [
			{ tileX: 0, tileY: 0, x: 0, y: 0, png: tinyPng },
			// edge tiles legitimately start before the viewport origin
			{ tileX: 1, tileY: 0, x: -128, y: 0, png: tinyPng }
		]);
		assert.equal(body.subarray(0, 4).toString('hex'), '89504e47');
	});

	test('encodes webp and avif', async () => {
		const webp = await renderStaticMapRaster(baseOptions, 'webp', []);
		assert.equal(webp.subarray(0, 4).toString(), 'RIFF');
		assert.equal(webp.subarray(8, 12).toString(), 'WEBP');

		const avif = await renderStaticMapRaster(baseOptions, 'avif', []);
		assert.match(avif.subarray(4, 12).toString(), /ftyp/);
	});

	test('composites the overlay over a provided basemap PNG', async () => {
		const body = await renderStaticMapRaster(baseOptions, 'png', [], tinyPng);
		assert.equal(body.subarray(0, 4).toString('hex'), '89504e47');
	});

	test('uses MAP_VIEWPORT defaults when size is omitted', async () => {
		const body = await renderStaticMapRaster(
			{ center: [-1.75, 50.65], zoom: 10, projectGeojson: square, consulteeGeojson: emptyCollection },
			'png',
			[]
		);
		assert.equal(body.subarray(0, 4).toString('hex'), '89504e47');
	});
});

describe('STATIC_MAP_CONTENT_TYPES', () => {
	test('covers each negotiated format', () => {
		assert.equal(STATIC_MAP_CONTENT_TYPES.avif, 'image/avif');
		assert.equal(STATIC_MAP_CONTENT_TYPES.webp, 'image/webp');
		assert.equal(STATIC_MAP_CONTENT_TYPES.png, 'image/png');
	});
});
