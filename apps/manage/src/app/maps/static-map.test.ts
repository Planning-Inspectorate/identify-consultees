import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import type { GeoJsonFeatureCollection } from './sample-geojson.ts';
import {
	ageOsmTileCacheForTests,
	buildGoogleStaticMapUrl,
	buildStaticMapSvg,
	centroidOfGeometry,
	clearOsmTileCacheForTests,
	consulteeColours,
	escapeXml,
	fetchOsmBasemapTiles,
	googleMapsApiKeyFromEnv,
	listOsmTilesForViewport,
	lngLatToWorldPixel,
	osmTileCacheSizeForTests,
	renderStaticMapOverlaySvg,
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

const originalFetch = globalThis.fetch;

afterEach(() => {
	clearOsmTileCacheForTests();
	globalThis.fetch = originalFetch;
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

	test('renderStaticMapSvg draws consultee polygons', () => {
		const svg = renderStaticMapSvg({
			center: [-1.75, 50.65],
			zoom: 10,
			projectGeojson: square,
			consulteeGeojson: square
		});

		assert.match(svg, /#55A868/);
		assert.match(svg, /#C44E52/);
	});

	test("consulteeColours uses a feature's own colour, or the default green", () => {
		const feature = (colour?: string, fillOpacity?: string) => ({
			type: 'Feature' as const,
			properties: { ...(colour ? { colour } : {}), ...(fillOpacity ? { fillOpacity } : {}) },
			geometry: { type: 'Point' as const, coordinates: [0, 0] as [number, number] }
		});
		assert.deepEqual(consulteeColours(feature('#1d70b8', '0.06')), {
			stroke: '#1d70b8',
			fill: '#1d70b8',
			fillOpacity: 0.06,
			googleFill: '0x1D70B80F',
			googleStroke: '0x1D70B8FF'
		});
		assert.equal(consulteeColours(feature('#1d70b8')).fillOpacity, 0.45);
		assert.equal(consulteeColours(feature('#1d70b8', 'lots')).googleFill, '0x1D70B873');
		assert.equal(consulteeColours(feature()).fill, '#55A868');
		assert.equal(consulteeColours(feature('red')).fill, '#55A868');
	});

	test('renderStaticMapOverlaySvg draws vectors on a transparent background', () => {
		const svg = renderStaticMapOverlaySvg({
			center: [-1.75, 50.65],
			zoom: 10,
			projectGeojson: square,
			consulteeGeojson: square
		});

		assert.match(svg, /<svg/);
		assert.match(svg, /#55A868/);
		assert.match(svg, /#C44E52/);
		// no opaque background or embedded tiles — composites over a raster basemap
		assert.doesNotMatch(svg, /#f5f5f0/);
		assert.doesNotMatch(svg, /data:image/);
	});

	test('renderStaticMapOverlaySvg draws markers, badges and point symbols', () => {
		const svg = renderStaticMapOverlaySvg({
			center: [-1.75, 50.65],
			zoom: 10,
			projectGeojson: emptyCollection,
			consulteeGeojson: emptyCollection,
			markers: [{ coords: [-1.75, 50.65], label: 'Demo marker' }, { coords: [-1.74, 50.66] }],
			featureBadges: [
				{ coords: [-1.75, 50.65], label: '1' },
				{ coords: [-1.74, 50.66], label: '2', fill: '#00897B' }
			]
		});

		// pin glyph + optional label
		assert.match(svg, /#1d70b8/);
		assert.match(svg, /Demo marker/);
		// badges: default dark fill and a custom category colour
		assert.match(svg, /#0b0c0c/);
		assert.match(svg, /#00897B/);
	});

	test('renderStaticMapOverlaySvg rejects badge fill values that are not hex colours', () => {
		const svg = renderStaticMapOverlaySvg({
			center: [-1.75, 50.65],
			zoom: 10,
			projectGeojson: emptyCollection,
			consulteeGeojson: emptyCollection,
			featureBadges: [
				{ coords: [-1.75, 50.65], label: '1', fill: '#00897B' },
				{ coords: [-1.74, 50.66], label: '2', fill: 'red' },
				{ coords: [-1.74, 50.64], label: '3', fill: '"/><script>alert(1)</script>' }
			]
		});

		// the valid hex colour renders; anything else falls back to the default
		assert.match(svg, /fill="#00897B"/);
		assert.equal(svg.match(/fill="#0b0c0c"/g)?.length, 2);
		assert.doesNotMatch(svg, /red|<script|alert/);
	});

	test('centroidOfGeometry centres rings, points and falls back to the first vertex', () => {
		assert.deepEqual(centroidOfGeometry({ type: 'Point', coordinates: [-1, 50] }), [-1, 50]);
		assert.deepEqual(
			centroidOfGeometry({
				type: 'Polygon',
				coordinates: [
					[
						[0, 0],
						[2, 0],
						[2, 2],
						[0, 2],
						[0, 0]
					]
				]
			}),
			[0.8, 0.8]
		);
		assert.deepEqual(
			centroidOfGeometry({
				type: 'MultiPolygon',
				coordinates: [
					[
						[
							[0, 0],
							[4, 0],
							[4, 4],
							[0, 4],
							[0, 0]
						]
					]
				]
			}),
			[1.6, 1.6]
		);
		// non-areal types fall back to the first collected vertex
		assert.deepEqual(
			centroidOfGeometry({
				type: 'LineString',
				coordinates: [
					[-1, 50],
					[-2, 51]
				]
			}),
			[-1, 50]
		);
		// an empty geometry yields undefined rather than NaN
		assert.equal(centroidOfGeometry({ type: 'Polygon', coordinates: [[]] }), undefined);
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
		globalThis.fetch = async () => {
			calls += 1;
			return new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png' } });
		};

		const first = await fetchOsmBasemapTiles({ center: [0, 0], zoom: 2, width: 128, height: 128 });
		assert.ok(first.length >= 1);
		assert.equal(osmTileCacheSizeForTests(), first.length);

		const afterWarm = calls;
		const second = await fetchOsmBasemapTiles({ center: [0, 0], zoom: 2, width: 128, height: 128 });
		assert.equal(second.length, first.length);
		assert.equal(calls, afterWarm);

		globalThis.fetch = async () => new Response('nope', { status: 500 });
		clearOsmTileCacheForTests();
		const failed = await fetchOsmBasemapTiles({ center: [0, 0], zoom: 2, width: 128, height: 128 });
		assert.equal(failed.length, 0);
	});

	test('fetchOsmBasemapTiles treats network errors as missing tiles', async () => {
		globalThis.fetch = async () => {
			throw new Error('network');
		};
		const tiles = await fetchOsmBasemapTiles({ center: [0, 0], zoom: 2, width: 128, height: 128 });
		assert.equal(tiles.length, 0);
	});

	test('fetchOsmBasemapTiles uses MAP_VIEWPORT defaults when size is omitted', async () => {
		globalThis.fetch = async () => new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png' } });
		const tiles = await fetchOsmBasemapTiles({ center: [0, 0], zoom: 2 });
		assert.ok(tiles.length > 0);
	});

	test('renderStaticMapSvg draws non-areal geometry types unfilled', () => {
		const nonAreal: GeoJsonFeatureCollection = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {},
					geometry: {
						type: 'LineString',
						coordinates: [
							[-1.8, 50.6],
							[-1.7, 50.6],
							[-1.6, 50.65]
						]
					}
				},
				{
					type: 'Feature',
					properties: {},
					geometry: {
						type: 'MultiLineString',
						coordinates: [
							[
								[-1.8, 50.6],
								[-1.7, 50.6]
							],
							[
								[-1.6, 50.6],
								[-1.5, 50.65]
							]
						]
					}
				},
				{
					type: 'Feature',
					properties: {},
					geometry: {
						type: 'MultiPoint',
						coordinates: [
							[-1.8, 50.6],
							[-1.7, 50.6]
						]
					}
				},
				{
					type: 'Feature',
					properties: {},
					geometry: {
						type: 'GeometryCollection',
						geometries: [
							{
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
							},
							{
								type: 'LineString',
								coordinates: [
									[-1.6, 50.6],
									[-1.5, 50.65]
								]
							}
						]
					}
				}
			]
		};

		const svg = renderStaticMapSvg({
			center: [-1.75, 50.65],
			zoom: 10,
			projectGeojson: nonAreal,
			consulteeGeojson: emptyCollection
		});
		assert.match(svg, /fill="none"/);
	});

	test('renderStaticMapSvg draws MultiPolygon features filled', () => {
		const multiPolygon: GeoJsonFeatureCollection = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {},
					geometry: {
						type: 'MultiPolygon',
						coordinates: [
							[
								[
									[-1.8, 50.6],
									[-1.7, 50.6],
									[-1.7, 50.7],
									[-1.8, 50.7],
									[-1.8, 50.6]
								]
							],
							[
								[
									[-1.6, 50.6],
									[-1.5, 50.6],
									[-1.5, 50.7],
									[-1.6, 50.7],
									[-1.6, 50.6]
								]
							]
						]
					}
				}
			]
		};

		const svg = renderStaticMapSvg({
			center: [-1.75, 50.65],
			zoom: 10,
			projectGeojson: multiPolygon,
			consulteeGeojson: emptyCollection
		});
		assert.match(svg, / Z M/);
	});

	test('renderStaticMapSvg omits a feature whose only line is too short to draw', () => {
		const tooShort: GeoJsonFeatureCollection = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {},
					geometry: { type: 'LineString', coordinates: [[-1.8, 50.6]] }
				}
			]
		};

		const svg = renderStaticMapSvg({
			center: [-1.75, 50.65],
			zoom: 10,
			projectGeojson: tooShort,
			consulteeGeojson: emptyCollection
		});
		assert.doesNotMatch(svg, /<path /);
	});

	test('buildGoogleStaticMapUrl skips lines shorter than two points and omits fillcolor for lines', () => {
		const mixed: GeoJsonFeatureCollection = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {},
					geometry: { type: 'LineString', coordinates: [[-1.8, 50.6]] }
				},
				{
					type: 'Feature',
					properties: {},
					geometry: {
						type: 'LineString',
						coordinates: [
							[-1.8, 50.6],
							[-1.7, 50.6]
						]
					}
				}
			]
		};

		const url = buildGoogleStaticMapUrl({
			center: [-1.75, 50.65],
			zoom: 10,
			projectGeojson: mixed,
			consulteeGeojson: emptyCollection,
			googleMapsApiKey: 'test-key'
		});
		assert.ok(url);
		const paths = new URL(url).searchParams.getAll('path');
		assert.equal(paths.length, 1);
		assert.doesNotMatch(paths[0], /fillcolor/);
	});

	test('fetchOsmBasemapTiles expires stale cache entries', async () => {
		let calls = 0;
		globalThis.fetch = async () => {
			calls += 1;
			return new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png' } });
		};

		await fetchOsmBasemapTiles({ center: [0, 0], zoom: 2, width: 256, height: 256 });
		assert.ok(osmTileCacheSizeForTests() > 0);
		const afterWarm = calls;

		ageOsmTileCacheForTests();
		await fetchOsmBasemapTiles({ center: [0, 0], zoom: 2, width: 256, height: 256 });
		assert.ok(calls > afterWarm);
	});
});
