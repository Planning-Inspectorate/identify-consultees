import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { GeoJsonFeatureCollection } from './sample-geojson.ts';
import {
	negotiateStaticMapFormat,
	renderStaticMapRaster,
	renderSvgBasemapImage,
	STATIC_MAP_CONTENT_TYPES
} from './static-map-raster.ts';

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

	test('basemap tiles actually land in the output pixels', async () => {
		// regression: a second .composite() call replaces the input list in
		// sharp, which used to silently discard every basemap tile
		const sharp = (await import('sharp')).default;
		const solidTile = await sharp({
			create: { width: 256, height: 256, channels: 3, background: '#204060' }
		})
			.png()
			.toBuffer();

		const body = await renderStaticMapRaster(baseOptions, 'png', [
			{ tileX: 0, tileY: 0, x: 0, y: 0, png: solidTile },
			{ tileX: 1, tileY: 0, x: 0, y: 0, png: solidTile }
		]);
		const stats = await sharp(body).stats();
		// a canvas of pure #f5f5f0 averages ~245 per channel; the dark tiles
		// must pull the means well below that or they were never composited
		assert.ok(stats.channels[0].mean < 200, `red mean ${stats.channels[0].mean} — basemap tiles missing`);
		assert.ok(stats.channels[2].mean < 200, `blue mean ${stats.channels[2].mean} — basemap tiles missing`);
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

	test('greys the basemap - tiles or a provided PNG - leaving the areas over it in colour', async () => {
		const sharp = (await import('sharp')).default;
		const green = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#00a000' } })
			.png()
			.toBuffer();
		const pixelAt = async (png: Buffer, x: number, y: number) => {
			const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
			return [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
		};
		const options = { ...baseOptions, projectGeojson: emptyCollection, basemap: 'greyscale' as const };
		for (const body of [
			await renderStaticMapRaster(options, 'png', [{ tileX: 0, tileY: 0, x: 0, y: 0, png: green }]),
			await renderStaticMapRaster(options, 'png', [], green)
		]) {
			// the basemap, away from the area: grey, and lighter than the green's grey
			const [r, g, b] = await pixelAt(body, 10, 10);
			assert.ok(r === g && g === b, `basemap ${[r, g, b]} isn't grey`);
			assert.ok(r > 120, `basemap ${r} isn't lightened`);
			// the consultee area, in the middle: still its green
			const [areaR, areaG] = await pixelAt(body, 128, 128);
			assert.ok(areaG > areaR + 20, `area ${[areaR, areaG]} lost its colour`);
		}
		// in colour unless asked
		const [r, g] = await pixelAt(
			await renderStaticMapRaster({ ...options, basemap: 'colour' }, 'png', [], green),
			10,
			10
		);
		assert.ok(g > r + 100);
	});

	test('draws any zoom, at any pixel ratio: the image is the map times its ratio, the tiles scaled to it', async () => {
		const sharp = (await import('sharp')).default;
		const green = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#00a000' } })
			.png()
			.toBuffer();
		// zoom 10.3 at 1.5 pixels per map pixel: tiles at zoom 11, on a canvas scaled down to the image
		const options = { ...baseOptions, zoom: 10.3, pixelRatio: 1.5 };
		const tiles = [0, 256].flatMap((x) => [0, 256].map((y) => ({ tileX: 0, tileY: 0, x, y, png: green })));
		const body = await renderStaticMapRaster(options, 'png', tiles);
		const { width, height, channels } = await sharp(body)
			.stats()
			.then(async (stats) => ({
				...(await sharp(body).metadata()),
				channels: stats.channels
			}));
		assert.deepEqual([width, height], [384, 384]);
		// the tiles cover it - scaled, not left at their own size in a corner
		assert.ok(channels[1].mean > channels[0].mean + 50, 'the basemap tiles were scaled over the whole image');
		// a Google basemap is fitted to the image's size too
		const google = await renderStaticMapRaster(options, 'png', [], green);
		assert.deepEqual([(await sharp(google).metadata()).width, (await sharp(google).metadata()).height], [384, 384]);
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

describe('renderSvgBasemapImage', () => {
	test('composites tiles into a single jpeg image', async () => {
		const jpeg = await renderSvgBasemapImage(baseOptions, [
			{ tileX: 0, tileY: 0, x: 0, y: 0, png: tinyPng },
			{ tileX: 1, tileY: 0, x: -128, y: 0, png: tinyPng }
		]);
		assert.equal(jpeg?.subarray(0, 3).toString('hex'), 'ffd8ff');
	});

	test('greys the tiles for a greyscale map', async () => {
		const sharp = (await import('sharp')).default;
		const green = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#00a000' } })
			.png()
			.toBuffer();
		const jpeg = await renderSvgBasemapImage({ ...baseOptions, basemap: 'greyscale' }, [
			{ tileX: 0, tileY: 0, x: 0, y: 0, png: green }
		]);
		const { channels } = await sharp(jpeg).stats();
		assert.ok(Math.abs(channels[0].mean - channels[1].mean) < 2, 'not grey');
	});

	test('returns undefined when there are no tiles', async () => {
		assert.equal(await renderSvgBasemapImage(baseOptions, []), undefined);
	});

	test('uses MAP_VIEWPORT defaults when size is omitted', async () => {
		const jpeg = await renderSvgBasemapImage({ zoom: 10 }, [{ tileX: 0, tileY: 0, x: 0, y: 0, png: tinyPng }]);
		assert.equal(jpeg?.subarray(0, 3).toString('hex'), 'ffd8ff');
	});
});
