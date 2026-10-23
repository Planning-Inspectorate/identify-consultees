import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import type { GeoJsonFeatureCollection } from './sample-geojson.ts';
import {
	ageOsmTileCacheForTests,
	basemapFrame,
	buildGoogleStaticMapUrl,
	buildStaticMapSvg,
	centroidOfGeometry,
	clearOsmTileCacheForTests,
	consulteeColours,
	escapeXml,
	fetchOsmBasemapTiles,
	googleMapsApiKeyFromEnv,
	insideRings,
	labelText,
	listOsmTilesForViewport,
	lngLatToWorldPixel,
	osmTileCacheSizeForTests,
	outputSize,
	renderStaticMapOverlaySvg,
	renderStaticMapSvg,
	staticMapViewportOrigin,
	visiblePathPoints
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

	test('renderStaticMapSvg draws polygons and an optional basemap image', () => {
		const svg = renderStaticMapSvg(
			{
				center: [-1.75, 50.65],
				zoom: 10,
				projectGeojson: square,
				consulteeGeojson: emptyCollection,
				title: 'Title & more',
				description: 'Desc <tag>'
			},
			tinyPng
		);

		assert.match(svg, /<svg/);
		assert.match(svg, /Title &amp; more/);
		assert.match(svg, /Desc &lt;tag&gt;/);
		assert.match(svg, /data:image\/jpeg;base64,/);
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
		assert.match(svg, /#ff0000/i);
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
		assert.match(svg, /#ff0000/i);
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

describe('visiblePathPoints', () => {
	test('keeps every point on or near the map', () => {
		const points: [number, number][] = [
			[0, 0],
			[-10, 50],
			[100, 516],
			[970, 20]
		];
		assert.deepEqual(visiblePathPoints(points, 960, 516), points);
	});

	test('keeps only the ends of a run beyond one edge - the line between them stays beyond it', () => {
		assert.deepEqual(
			visiblePathPoints(
				[
					[100, 100],
					[-50, 100],
					[-300, -900],
					[-800, 2000],
					[-60, 300],
					[200, 300]
				],
				960,
				516
			),
			[
				[100, 100],
				[-50, 100],
				[-60, 300],
				[200, 300]
			]
		);
	});

	test('ends a run when the points go beyond a different edge', () => {
		// beyond the left, then above - the corner between is kept, so the line doesn't cut across the map
		assert.deepEqual(
			visiblePathPoints(
				[
					[-100, 300],
					[-100, 200],
					[-100, -100],
					[500, -100],
					[700, -100]
				],
				960,
				516
			),
			[
				[-100, 300],
				[-100, -100],
				[500, -100],
				[700, -100]
			]
		);
	});

	test('keeps a lone point beyond an edge, and a whole path off the map as its two ends', () => {
		assert.deepEqual(visiblePathPoints([[2000, 100]], 960, 516), [[2000, 100]]);
		assert.deepEqual(
			visiblePathPoints(
				[
					[100, 2000],
					[200, 2100],
					[300, 2000]
				],
				960,
				516
			),
			[
				[100, 2000],
				[300, 2000]
			]
		);
	});

	test('writes a far smaller path for an area mostly off the map, and none of a point that rounds to the last', () => {
		const coastline = Array.from({ length: 2_000 }, (_, i) => [-3 + i * 0.001, 55 + (i % 2) * 0.001]);
		const svg = renderStaticMapOverlaySvg({
			center: [-1.5, 52.5],
			zoom: 12,
			width: 960,
			height: 516,
			projectGeojson: { type: 'FeatureCollection', features: [] },
			consulteeGeojson: {
				type: 'FeatureCollection',
				features: [
					{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coastline } },
					{
						type: 'Feature',
						properties: {},
						geometry: {
							type: 'LineString',
							coordinates: [
								[-1.5, 52.5],
								[-1.5, 52.5],
								[-1.49, 52.5]
							]
						}
					}
				]
			}
		});
		const paths = [...svg.matchAll(/<path d="([^"]*)"/g)].map((match) => match[1]);
		// 2,000 points far above the map - just the two ends
		assert.equal(paths[0].split(/[ML]/).filter(Boolean).length, 2);
		assert.equal(paths[1].split(/[ML]/).filter(Boolean).length, 2);
	});
});

// the labels and buffers the report's maps draw

const MAP = { center: [-1.75, 50.65] as const, zoom: 10, width: 400, height: 300 };

function box(west: number, south: number, east: number, north: number) {
	return {
		type: 'Polygon' as const,
		coordinates: [
			[
				[west, south],
				[east, south],
				[east, north],
				[west, north],
				[west, south]
			]
		]
	};
}

function collection(
	...features: { properties: Record<string, unknown>; geometry: unknown }[]
): GeoJsonFeatureCollection {
	return {
		type: 'FeatureCollection',
		features: features.map((feature) => ({ type: 'Feature', ...feature })) as GeoJsonFeatureCollection['features']
	};
}

/** Where on the test map a position draws. */
function pixel(lng: number, lat: number): [number, number] {
	const { left, top } = staticMapViewportOrigin(MAP.center, MAP.zoom, MAP.width, MAP.height);
	const [x, y] = lngLatToWorldPixel(lng, lat, MAP.zoom);
	return [x - left, y - top];
}

/** Each label drawn: its text and where its middle is. */
function labels(svg: string): { text: string; x: number; y: number }[] {
	return [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"[^>]*>([^<]*)<\/text>/g)].map(([, x, y, text]) => ({
		text,
		x: Number(x),
		// drawn from its baseline, a little below its middle
		y: Number(y) - 11 * 0.35
	}));
}

function overlay(consultees: GeoJsonFeatureCollection, extra: Record<string, unknown> = {}): string {
	return renderStaticMapOverlaySvg({
		...MAP,
		projectGeojson: emptyCollection,
		consulteeGeojson: consultees,
		labels: true,
		...extra
	});
}

describe('static-map labels', () => {
	test('names each area inside it, once per name, where labels have room', () => {
		const svg = overlay(
			collection(
				// a county around the whole map
				{ properties: { name: 'Big County' }, geometry: box(-3, 49.5, -0.5, 51.8) },
				{ properties: { name: 'Abbey Parish' }, geometry: box(-1.8, 50.6, -1.7, 50.7) },
				// another of its areas - named once
				{ properties: { name: 'Abbey Parish' }, geometry: box(-1.65, 50.6, -1.6, 50.65) },
				{ properties: { name: '' }, geometry: box(-1.75, 50.6, -1.7, 50.65) },
				{ properties: {}, geometry: box(-1.75, 50.6, -1.7, 50.65) }
			)
		);
		const drawn = labels(svg);
		assert.deepEqual(drawn.map(({ text }) => text).toSorted(), ['Abbey Parish', 'Big County']);
		// on the smaller of its areas - placed first, as it has fewest spots
		const abbey = drawn.find(({ text }) => text === 'Abbey Parish')!;
		const [west, north] = pixel(-1.65, 50.65);
		const [east, south] = pixel(-1.6, 50.6);
		assert.ok(abbey.x > west && abbey.x < east && abbey.y > north && abbey.y < south, JSON.stringify(abbey));
		// the county's label is on the map, clear of the parish's
		const county = drawn.find(({ text }) => text === 'Big County')!;
		assert.ok(county.x > 0 && county.x < MAP.width && county.y > 0 && county.y < MAP.height);
		assert.ok(Math.abs(county.y - abbey.y) >= 14 || Math.abs(county.x - abbey.x) >= 70);
		// with a halo, over everything else
		assert.match(svg, /stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke">Abbey/);
		assert.ok(svg.lastIndexOf('<path') < svg.indexOf('<text'));
	});

	test('names a line on it, a point at it, and an area smaller than the grid at its middle', () => {
		const drawn = labels(
			overlay(
				collection(
					{
						properties: { name: 'Railway' },
						geometry: {
							type: 'LineString',
							coordinates: [
								[-1.85, 50.62],
								[-1.65, 50.62]
							]
						}
					},
					{ properties: { name: 'Port' }, geometry: { type: 'Point', coordinates: [-1.75, 50.68] } },
					{ properties: { name: 'Tiny' }, geometry: box(-1.701, 50.655, -1.699, 50.656) }
				)
			)
		);
		const at = (text: string) => drawn.find((label) => label.text === text)!;
		assert.ok(Math.abs(at('Railway').y - pixel(-1.75, 50.62)[1]) < 1);
		const [portX, portY] = pixel(-1.75, 50.68);
		assert.ok(Math.abs(at('Port').x - portX) < 1 && Math.abs(at('Port').y - portY) < 1);
		const [tinyX, tinyY] = pixel(-1.7, 50.6555);
		assert.ok(Math.abs(at('Tiny').x - tinyX) < 1 && Math.abs(at('Tiny').y - tinyY) < 1);
	});

	test('leaves out a label with nowhere free, and an area off the map', () => {
		const drawn = labels(
			overlay(
				collection(
					{ properties: { name: 'First' }, geometry: box(-1.701, 50.655, -1.699, 50.656) },
					{ properties: { name: 'Second' }, geometry: box(-1.701, 50.655, -1.699, 50.656) },
					{ properties: { name: 'Far away' }, geometry: box(0, 52, 0.1, 52.1) },
					{
						properties: { name: 'Far railway' },
						geometry: {
							type: 'LineString',
							coordinates: [
								[0, 52],
								[0.1, 52.1]
							]
						}
					},
					// on the map, but too near its edge for a label
					{ properties: { name: 'Edge' }, geometry: box(-2.024, 50.556, -2.022, 50.557) }
				)
			)
		);
		assert.deepEqual(
			drawn.map(({ text }) => text),
			['First']
		);
	});

	test('draws no labels unless asked', () => {
		const svg = overlay(collection({ properties: { name: 'Abbey Parish' }, geometry: box(-1.8, 50.6, -1.7, 50.7) }), {
			labels: false
		});
		assert.doesNotMatch(svg, /<text/);
	});

	test('keeps a name to one short line', () => {
		assert.equal(labelText('  Abbey \n Parish  '), 'Abbey Parish');
		assert.equal(labelText('A'.repeat(40)), 'A'.repeat(40));
		assert.equal(labelText(`${'A'.repeat(38)} BBB`), `${'A'.repeat(38)}…`);
		assert.equal(labelText('<Parish & Town>'), '<Parish & Town>');
		assert.match(
			overlay(collection({ properties: { name: '<Parish & Town>' }, geometry: box(-1.8, 50.6, -1.7, 50.7) })),
			/>&lt;Parish &amp; Town&gt;</
		);
	});

	test('counts a hole as outside its area', () => {
		const rings: [number, number][][] = [
			[
				[0, 0],
				[10, 0],
				[10, 10],
				[0, 10],
				[0, 0]
			],
			[
				[4, 4],
				[6, 4],
				[6, 6],
				[4, 6],
				[4, 4]
			]
		];
		assert.equal(insideRings([2, 2], rings), true);
		assert.equal(insideRings([5, 5], rings), false);
		assert.equal(insideRings([12, 5], rings), false);
	});
});

describe('static-map buffers', () => {
	test('draws each buffer dashed and unfilled, named on its outline above the site, else below it', () => {
		const svg = overlay(emptyCollection, {
			labels: false,
			bufferGeojson: collection(
				{ properties: { label: '2 km' }, geometry: box(-1.8, 50.62, -1.7, 50.68) },
				// its top is off the map
				{ properties: { label: '10 km' }, geometry: box(-1.9, 50.6, -1.6, 52) },
				{ properties: {}, geometry: box(-1.85, 50.61, -1.65, 50.69) },
				// beside the site, not around it - nowhere above or below it to go
				{ properties: { label: 'beside' }, geometry: box(-1.72, 50.6, -1.7, 50.7) },
				// nothing to draw
				{ properties: { label: 'none' }, geometry: { type: 'Polygon', coordinates: [[[-1.8, 50.6]]] } }
			)
		});
		assert.equal(svg.match(/stroke-dasharray="8 5"/g)?.length, 4);
		assert.match(svg, /<path d="[^"]+" fill="none" stroke="#0b0c0c" stroke-width="2" stroke-dasharray="8 5"\/>/);
		const drawn = labels(svg);
		assert.deepEqual(
			drawn.map(({ text }) => text),
			['2 km', '10 km']
		);
		assert.ok(Math.abs(drawn[0].y - pixel(-1.75, 50.68)[1]) < 1);
		assert.ok(Math.abs(drawn[1].y - pixel(-1.75, 50.6)[1]) < 1);
		assert.ok(drawn.every(({ x }) => x === MAP.width / 2));
	});

	test("keeps the areas' labels clear of a buffer's", () => {
		const drawn = labels(
			overlay(collection({ properties: { name: 'Abbey Parish' }, geometry: box(-1.8, 50.6, -1.7, 50.7) }), {
				bufferGeojson: collection({ properties: { label: '2 km' }, geometry: box(-1.8, 50.6, -1.7, 50.65) })
			})
		);
		assert.deepEqual(
			drawn.map(({ text }) => text),
			['2 km', 'Abbey Parish']
		);
		assert.ok(Math.abs(drawn[0].y - drawn[1].y) >= 14 || Math.abs(drawn[0].x - drawn[1].x) >= 70);
	});
});

describe('static-map zoom and pixel ratio', () => {
	test('draws a whole zoom at one pixel ratio just as it is', () => {
		assert.deepEqual(basemapFrame({ zoom: 10, width: 960, height: 516 }), { zoom: 10, width: 960, height: 516 });
		assert.deepEqual(outputSize({}), { width: 960, height: 516 });
	});

	test('draws any other zoom from the nearest whole one, on a canvas scaled to match', () => {
		// zoom 10.3: tiles at 10, on a canvas 2^-0.3 the size, scaled up to the image
		assert.deepEqual(basemapFrame({ zoom: 10.3, width: 960, height: 516 }), {
			zoom: 10,
			width: Math.round(960 * 2 ** -0.3),
			height: Math.round(516 * 2 ** -0.3)
		});
		// at 1.5 pixels per map pixel the image is 1.5 times the size, its tiles a zoom nearer
		assert.deepEqual(outputSize({ width: 960, height: 516, pixelRatio: 1.5 }), { width: 1440, height: 774 });
		const frame = basemapFrame({ zoom: 10, width: 960, height: 516, pixelRatio: 1.5 });
		assert.equal(frame.zoom, 11);
		assert.equal(frame.width, Math.round(1440 * 2 ** (11 - 10 - Math.log2(1.5))));
		// never past the zooms OpenStreetMap draws
		assert.equal(basemapFrame({ zoom: 22, width: 960, height: 516 }).zoom, 19);
		assert.equal(basemapFrame({ zoom: -3, width: 960, height: 516 }).zoom, 0);
	});

	test('sizes the overlay by the pixel ratio, drawing it in map pixels so lines and labels scale with it', () => {
		const svg = renderStaticMapOverlaySvg({
			center: [-1.75, 50.65],
			zoom: 10.4,
			width: 400,
			height: 300,
			pixelRatio: 1.5,
			projectGeojson: square,
			consulteeGeojson: emptyCollection
		});
		assert.match(svg, /width="600" height="450" viewBox="0 0 400 300"/);
		// the SVG variant embeds it at the map's size
		assert.match(
			renderStaticMapSvg({
				center: [-1.75, 50.65],
				zoom: 10,
				width: 400,
				height: 300,
				pixelRatio: 2,
				projectGeojson: square,
				consulteeGeojson: emptyCollection
			}),
			/<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="400" height="300" viewBox="0 0 400 300">/
		);
	});

	test("fetches the frame's tiles for a zoom between whole ones", async () => {
		const requested: string[] = [];
		globalThis.fetch = (async (url: string) => {
			requested.push(url);
			return new Response(tinyPng, { status: 200 });
		}) as typeof fetch;
		await fetchOsmBasemapTiles({ center: [-1.75, 50.65], zoom: 10.4, width: 256, height: 256 });
		assert.ok(requested.length > 0 && requested.every((url) => url.startsWith('https://tile.openstreetmap.org/10/')));
	});
});
