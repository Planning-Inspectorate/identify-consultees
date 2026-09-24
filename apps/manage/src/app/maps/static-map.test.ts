import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import type { GeoJsonFeatureCollection } from './sample-geojson.ts';
import {
	buildGoogleStaticMapUrl,
	buildStaticMapSvg,
	clearOsmTileCacheForTests,
	escapeXml,
	fetchOsmBasemapTiles,
	googleMapsApiKeyFromEnv,
	listOsmTilesForViewport,
	lngLatToWorldPixel,
	osmTileCacheSizeForTests,
	renderStaticMapSvg,
	staticMapViewportOrigin
} from './static-map.ts';

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

afterEach(() => {
	clearOsmTileCacheForTests();
});

describe('static-map helpers', () => {
	test('googleMapsApiKeyFromEnv reads trimmed key', () => {
		assert.equal(googleMapsApiKeyFromEnv({}), undefined);
		assert.equal(googleMapsApiKeyFromEnv({ GOOGLE_MAPS_API_KEY: '  ' }), undefined);
		assert.equal(googleMapsApiKeyFromEnv({ GOOGLE_MAPS_API_KEY: ' abc ' }), 'abc');
	});

	test('lngLatToWorldPixel and viewport helpers cover tile listing edges', () => {
		const [x, y] = lngLatToWorldPixel(0, 0, 2);
		assert.ok(Number.isFinite(x) && Number.isFinite(y));

		const origin = staticMapViewportOrigin([0, 0], 2, 256, 256);
		assert.ok(Number.isFinite(origin.left) && Number.isFinite(origin.top));

		const tiles = listOsmTilesForViewport(origin.left, origin.top - 400, 256, 900, 2);
		assert.ok(tiles.length > 0);
		assert.ok(tiles.every((tile) => tile.tileY >= 0));
	});

	test('escapeXml encodes reserved characters', () => {
		assert.equal(escapeXml('a&b<c>"d"\'e'), 'a&amp;b&lt;c&gt;&quot;d&quot;&apos;e');
	});

	test('renderStaticMapSvg draws polygons and optional basemap tiles', () => {
		const svg = renderStaticMapSvg(
			{
				center: [-1.75, 50.65],
				zoom: 10,
				projectGeojson: square,
				consulteeGeojson: emptyCollection,
				title: 'Title & more',
				description: 'Desc <tag>'
			},
			[{ tileX: 0, tileY: 0, x: 0, y: 0, png: tinyPng }]
		);

		assert.match(svg, /<svg/);
		assert.match(svg, /Title &amp; more/);
		assert.match(svg, /Desc &lt;tag&gt;/);
		assert.match(svg, /data:image\/png;base64,/);
		assert.match(svg, /<path /);
	});

	test('buildStaticMapSvg delegates to renderStaticMapSvg', () => {
		const svg = buildStaticMapSvg({
			center: [-1.75, 50.65],
			zoom: 10,
			projectGeojson: square,
			consulteeGeojson: emptyCollection
		});
		assert.match(svg, /<svg/);
	});

	test('renderStaticMapSvg skips incomplete rings', () => {
		const incomplete: GeoJsonFeatureCollection = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {},
					geometry: {
						type: 'Polygon',
						coordinates: [
							[
								[-1.8, 50.6],
								[-1.7, 50.6]
							]
						]
					}
				},
				{
					type: 'Feature',
					properties: {},
					geometry: {
						type: 'Polygon',
						coordinates: [
							[
								[-1.8, 50.6],
								[-1.7, 50.6],
								[undefined as unknown as number, 50.7],
								[-1.8, 50.7],
								[-1.8, 50.6]
							]
						]
					}
				}
			]
		};

		const svg = renderStaticMapSvg({
			center: [-1.75, 50.65],
			zoom: 10,
			projectGeojson: incomplete,
			consulteeGeojson: emptyCollection
		});
		assert.match(svg, /<svg/);
	});

	test('buildGoogleStaticMapUrl returns undefined without a key', () => {
		assert.equal(
			buildGoogleStaticMapUrl({
				center: [-1.75, 50.65],
				zoom: 10,
				projectGeojson: square,
				consulteeGeojson: emptyCollection
			}),
			undefined
		);
	});

	test('buildGoogleStaticMapUrl encodes paths when a key is present', () => {
		const url = buildGoogleStaticMapUrl({
			center: [-1.75, 50.65],
			zoom: 10,
			projectGeojson: square,
			consulteeGeojson: square,
			googleMapsApiKey: 'test-key'
		});
		assert.ok(url);
		assert.match(url, /maps\.googleapis\.com/);
		assert.match(url, /enc%3A|enc:/);
		assert.match(url, /key=test-key/);
	});

	test('buildGoogleStaticMapUrl returns undefined when the URL would be too long', () => {
		const manyPoints = Array.from({ length: 8_000 }, (_, index) => [
			-179 + (index % 358) + index * 1e-6,
			-85 + (index % 170) + index * 1e-6
		]);
		manyPoints.push(manyPoints[0]);
		const dense: GeoJsonFeatureCollection = {
			type: 'FeatureCollection',
			features: Array.from({ length: 4 }, () => ({
				type: 'Feature' as const,
				properties: {},
				geometry: { type: 'Polygon' as const, coordinates: [manyPoints] }
			}))
		};

		const url = buildGoogleStaticMapUrl({
			center: [-1.75, 50.65],
			zoom: 10,
			projectGeojson: dense,
			consulteeGeojson: dense,
			googleMapsApiKey: 'k'.repeat(200)
		});
		assert.equal(url, undefined);
	});

	test('buildGoogleStaticMapUrl skips incomplete features', () => {
		const incomplete: GeoJsonFeatureCollection = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {},
					geometry: {
						type: 'Polygon',
						coordinates: [
							[
								[0, 0],
								[1, 1]
							]
						]
					}
				},
				{
					type: 'Feature',
					properties: {},
					geometry: {
						type: 'Polygon',
						coordinates: [
							[
								[0, 0],
								[1, 0],
								[undefined as unknown as number, 1],
								[0, 1],
								[0, 0]
							]
						]
					}
				}
			]
		};

		const url = buildGoogleStaticMapUrl({
			center: [0.5, 0.5],
			zoom: 8,
			projectGeojson: incomplete,
			consulteeGeojson: emptyCollection,
			googleMapsApiKey: 'test-key'
		});
		assert.ok(url);
	});

	test('fetchOsmBasemapTiles caches successful responses and skips failures', async () => {
		let calls = 0;
		const successFetch: typeof fetch = async () => {
			calls += 1;
			return new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png' } });
		};

		const first = await fetchOsmBasemapTiles({ center: [0, 0], zoom: 2, width: 128, height: 128 }, successFetch);
		assert.ok(first.length >= 1);
		assert.equal(osmTileCacheSizeForTests(), first.length);

		const afterWarm = calls;
		const second = await fetchOsmBasemapTiles({ center: [0, 0], zoom: 2, width: 128, height: 128 }, successFetch);
		assert.equal(second.length, first.length);
		assert.equal(calls, afterWarm);

		const failingFetch: typeof fetch = async () => new Response('nope', { status: 500 });
		clearOsmTileCacheForTests();
		const failed = await fetchOsmBasemapTiles({ center: [0, 0], zoom: 2, width: 128, height: 128 }, failingFetch);
		assert.equal(failed.length, 0);
	});

	test('fetchOsmBasemapTiles treats network errors as missing tiles', async () => {
		const fetchImpl: typeof fetch = async () => {
			throw new Error('network');
		};
		const tiles = await fetchOsmBasemapTiles({ center: [0, 0], zoom: 2, width: 128, height: 128 }, fetchImpl);
		assert.equal(tiles.length, 0);
	});

	test('fetchOsmBasemapTiles expires stale cache entries', async () => {
		let calls = 0;
		const fetchImpl: typeof fetch = async () => {
			calls += 1;
			return new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png' } });
		};

		await fetchOsmBasemapTiles({ center: [0, 0], zoom: 2, width: 256, height: 256 }, fetchImpl);
		assert.ok(osmTileCacheSizeForTests() > 0);
		const afterWarm = calls;

		const realNow = Date.now;
		Date.now = () => realNow() + 25 * 60 * 60 * 1000;
		try {
			await fetchOsmBasemapTiles({ center: [0, 0], zoom: 2, width: 256, height: 256 }, fetchImpl);
			assert.ok(calls > afterWarm);
		} finally {
			Date.now = realNow;
		}
	});
});
