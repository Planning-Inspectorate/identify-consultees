/**
 * Server-side static map generation for progressive enhancement.
 *
 * Prefer Google Maps Static API (PNG) when `GOOGLE_MAPS_API_KEY` is set.
 * Otherwise render SVG with OpenStreetMap raster tiles (PNG) embedded as
 * data URIs, plus the same project / consultee polygons as the interactive map.
 *
 * Tile and static-image upstreams must be used sparingly — see AGENTS.md.
 */

import type { Geometry, Position } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';
import { fetchWithTimeout, MapCache } from '@planning-inspectorate/core/util';
import type { GeoJsonFeature, GeoJsonFeatureCollection } from './sample-geojson.ts';
import { MAP_VIEWPORT } from './sample-geojson.ts';

export type LngLat = readonly [number, number];

export type OsmBasemapTile = {
	tileX: number;
	tileY: number;
	x: number;
	y: number;
	png: Buffer;
};

export type StaticMapBuildOptions = {
	center: LngLat;
	zoom: number;
	projectGeojson: GeoJsonFeatureCollection;
	consulteeGeojson: GeoJsonFeatureCollection;
	width?: number;
	height?: number;
	googleMapsApiKey?: string;
	title?: string;
	description?: string;
	/** Pin glyphs for marker-style examples. */
	markers?: { coords: LngLat; label?: string }[];
	/** Small numbered badges tying map features to the legend list below the page image. */
	featureBadges?: { coords: LngLat; label: string; fill?: string }[];
};

const GOOGLE_STATIC_MAP_MAX_URL_LENGTH = 16_384;
const OSM_TILE_SIZE = 256;
const OSM_USER_AGENT = 'identify-consultees/0.1 (+https://github.com/Planning-Inspectorate/identify-consultees)';
const OSM_TILE_FETCH_CONCURRENCY = 2;
// tiles are small; a slow or dead tile server must not stall the page render
const OSM_TILE_FETCH_TIMEOUT_MS = 10_000;

type FeatureColours = { stroke: string; fill: string; fillOpacity: number; googleFill: string; googleStroke: string };

const PROJECT_COLOUR: FeatureColours = {
	stroke: '#C44E52',
	fill: '#C44E52',
	fillOpacity: 0.45,
	googleFill: '0xC44E5266',
	googleStroke: '0xC44E52FF'
};
const CONSULTEE_COLOUR: FeatureColours = {
	stroke: '#55A868',
	fill: '#55A868',
	fillOpacity: 0.45,
	googleFill: '0x55A86866',
	googleStroke: '0x55A868FF'
};

/**
 * A consultee's own category colour and fill opacity (its `colour` and `fillOpacity` properties),
 * or the default consultee green.
 */
export function consulteeColours(feature: GeoJsonFeature): FeatureColours {
	const colour = feature.properties.colour;
	if (typeof colour !== 'string' || !/^#[0-9a-f]{6}$/i.test(colour)) {
		return CONSULTEE_COLOUR;
	}
	const opacity = Number(feature.properties.fillOpacity);
	const fillOpacity = opacity > 0 && opacity <= 1 ? opacity : CONSULTEE_COLOUR.fillOpacity;
	const google = `0x${colour.slice(1).toUpperCase()}`;
	const googleAlpha = Math.round(fillOpacity * 255)
		.toString(16)
		.padStart(2, '0')
		.toUpperCase();
	return {
		stroke: colour,
		fill: colour,
		fillOpacity,
		googleFill: `${google}${googleAlpha}`,
		googleStroke: `${google}FF`
	};
}

// tiles keep for a day - core's MapCache is the TTL map this needs
const osmTileCache = new MapCache<Buffer>(24 * 60);

export function clearOsmTileCacheForTests(): void {
	osmTileCache.cache.clear();
}

export function osmTileCacheSizeForTests(): number {
	return osmTileCache.cache.size;
}

export function ageOsmTileCacheForTests(): void {
	for (const entry of osmTileCache.cache.values()) {
		entry.updated = new Date(0);
	}
}

export function googleMapsApiKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const key = env.GOOGLE_MAPS_API_KEY?.trim();
	return key || undefined;
}

export function lngLatToWorldPixel(lng: number, lat: number, zoom: number): [number, number] {
	const clampedLat = Math.max(-85.051_128_78, Math.min(85.051_128_78, lat));
	const scale = OSM_TILE_SIZE * 2 ** zoom;
	const x = ((lng + 180) / 360) * scale;
	const sinLat = Math.sin((clampedLat * Math.PI) / 180);
	const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
	return [x, y];
}

export function staticMapViewportOrigin(
	center: LngLat,
	zoom: number,
	width: number,
	height: number
): { left: number; top: number } {
	const [cx, cy] = lngLatToWorldPixel(center[0], center[1], zoom);
	return { left: cx - width / 2, top: cy - height / 2 };
}

export function listOsmTilesForViewport(
	left: number,
	top: number,
	width: number,
	height: number,
	zoom: number
): { tileX: number; tileY: number; x: number; y: number }[] {
	const tileCount = 2 ** zoom;
	const startX = Math.floor(left / OSM_TILE_SIZE);
	const endX = Math.floor((left + width - 1) / OSM_TILE_SIZE);
	const startY = Math.floor(top / OSM_TILE_SIZE);
	const endY = Math.floor((top + height - 1) / OSM_TILE_SIZE);
	const tiles: { tileX: number; tileY: number; x: number; y: number }[] = [];

	for (let ty = startY; ty <= endY; ty += 1) {
		if (ty < 0 || ty >= tileCount) {
			continue;
		}
		for (let tx = startX; tx <= endX; tx += 1) {
			const wrappedX = ((tx % tileCount) + tileCount) % tileCount;
			tiles.push({
				tileX: wrappedX,
				tileY: ty,
				x: tx * OSM_TILE_SIZE - left,
				y: ty * OSM_TILE_SIZE - top
			});
		}
	}
	return tiles;
}

function tileCacheKey(zoom: number, tileX: number, tileY: number): string {
	return `${zoom}/${tileX}/${tileY}`;
}

/**
 * Fetch OSM raster tiles for a viewport, reusing the in-process tile cache.
 * Low concurrency and identifying User-Agent follow OSM tile usage policy.
 */
export async function fetchOsmBasemapTiles(
	options: Pick<StaticMapBuildOptions, 'center' | 'zoom' | 'width' | 'height'>
): Promise<OsmBasemapTile[]> {
	const width = options.width ?? MAP_VIEWPORT.width;
	const height = options.height ?? MAP_VIEWPORT.height;
	const zoom = Math.round(options.zoom);
	const { left, top } = staticMapViewportOrigin(options.center, zoom, width, height);
	const wanted = listOsmTilesForViewport(left, top, width, height, zoom);
	const tiles: OsmBasemapTile[] = [];

	for (let i = 0; i < wanted.length; i += OSM_TILE_FETCH_CONCURRENCY) {
		const batch = wanted.slice(i, i + OSM_TILE_FETCH_CONCURRENCY);
		const results = await Promise.all(
			batch.map(async (tile) => {
				const key = tileCacheKey(zoom, tile.tileX, tile.tileY);
				const cached = osmTileCache.get(key);
				if (cached) {
					return { ...tile, png: cached } satisfies OsmBasemapTile;
				}

				const url = `https://tile.openstreetmap.org/${zoom}/${tile.tileX}/${tile.tileY}.png`;
				try {
					const response = await fetchWithTimeout(
						url,
						{
							timeoutMs: OSM_TILE_FETCH_TIMEOUT_MS
						},
						{
							headers: { 'User-Agent': OSM_USER_AGENT, Accept: 'image/png' }
						}
					);
					if (!response.ok) {
						return undefined;
					}
					const png = Buffer.from(await response.arrayBuffer());
					osmTileCache.set(key, png);
					return { ...tile, png } satisfies OsmBasemapTile;
				} catch {
					return undefined;
				}
			})
		);
		for (const tile of results) {
			if (tile) {
				tiles.push(tile);
			}
		}
	}

	return tiles;
}

function encodeGooglePolyline(ring: number[][]): string {
	let lastLat = 0;
	let lastLng = 0;
	let result = '';

	const points = ring.slice();
	const first = points[0];
	const last = points[points.length - 1];
	if (points.length > 1 && first?.[0] === last?.[0] && first?.[1] === last?.[1]) {
		points.pop();
	}

	for (const point of points) {
		const lng = point[0];
		const lat = point[1];
		if (lng === undefined || lat === undefined) {
			continue;
		}
		const latE5 = Math.round(lat * 1e5);
		const lngE5 = Math.round(lng * 1e5);
		result += encodeSigned(latE5 - lastLat);
		result += encodeSigned(lngE5 - lastLng);
		lastLat = latE5;
		lastLng = lngE5;
	}

	return result;
}

function encodeSigned(value: number): string {
	let n = value < 0 ? ~(value << 1) : value << 1;
	let output = '';
	while (n >= 0x20) {
		output += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
		n >>= 5;
	}
	output += String.fromCharCode(n + 63);
	return output;
}

/** A point's tiny square footprint, in degrees - just enough to give a bare Point something to draw. */
const POINT_MARKER_RADIUS_DEGREES = 0.0005;

function pointToRing([lng, lat]: Position): Position[] {
	const r = POINT_MARKER_RADIUS_DEGREES;
	return [
		[lng - r, lat - r],
		[lng + r, lat - r],
		[lng + r, lat + r],
		[lng - r, lat + r],
		[lng - r, lat - r]
	];
}

/** Areal geometry types are drawn filled; everything else (lines, points) is drawn as an outline only. */
function isArealGeometryType(type: Geometry['type']): boolean {
	return type === 'Polygon' || type === 'MultiPolygon' || type === 'Point' || type === 'MultiPoint';
}

/**
 * Flatten any GeoJSON geometry into the individual lines/rings a renderer draws - one entry per
 * SVG subpath or Google Static Maps `path=` parameter. Real consultee/project geometries include
 * lines (e.g. railways) as well as polygons, so this can't assume every feature is a closed ring.
 */
function collectLines(geometry: Geometry): Position[][] {
	switch (geometry.type) {
		case 'Point':
			return [pointToRing(geometry.coordinates)];
		case 'MultiPoint':
			return geometry.coordinates.map(pointToRing);
		case 'LineString':
			return [geometry.coordinates];
		case 'MultiLineString':
			return geometry.coordinates;
		case 'Polygon':
			return geometry.coordinates;
		case 'MultiPolygon':
			return geometry.coordinates.flat();
		case 'GeometryCollection':
			return geometry.geometries.flatMap(collectLines);
	}
}

export function buildGoogleStaticMapUrl(options: StaticMapBuildOptions): string | undefined {
	const key = options.googleMapsApiKey?.trim();
	if (!key) {
		return undefined;
	}

	const width = options.width ?? MAP_VIEWPORT.width;
	const height = options.height ?? MAP_VIEWPORT.height;
	const params = new URLSearchParams({
		size: `${width}x${height}`,
		scale: '1',
		maptype: 'roadmap',
		key
	});
	params.append('center', `${options.center[1]},${options.center[0]}`);
	params.append('zoom', String(Math.round(options.zoom)));

	for (const feature of options.consulteeGeojson.features) {
		appendGooglePath(params, feature, consulteeColours(feature));
	}
	for (const feature of options.projectGeojson.features) {
		appendGooglePath(params, feature, PROJECT_COLOUR);
	}

	const url = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
	if (url.length > GOOGLE_STATIC_MAP_MAX_URL_LENGTH) {
		return undefined;
	}
	return url;
}

function appendGooglePath(
	params: URLSearchParams,
	feature: GeoJsonFeature,
	colours: { googleFill: string; googleStroke: string }
): void {
	const filled = isArealGeometryType(feature.geometry.type);
	for (const line of collectLines(feature.geometry)) {
		if (line.length < 2) {
			continue;
		}
		const encoded = encodeGooglePolyline(line);
		const fillPart = filled ? `fillcolor:${colours.googleFill}|` : '';
		params.append('path', `${fillPart}color:${colours.googleStroke}|weight:2|enc:${encoded}`);
	}
}

export function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function svgPathCommandsForLine(line: Position[], project: (lng: number, lat: number) => [number, number]): string {
	const commands: string[] = [];
	for (let i = 0; i < line.length; i += 1) {
		const point = line[i];
		if (point?.[0] === undefined || point?.[1] === undefined) {
			continue;
		}
		const [x, y] = project(point[0], point[1]);
		commands.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
	}
	return commands.join(' ');
}

function pathForFeature(
	feature: GeoJsonFeature,
	project: (lng: number, lat: number) => [number, number],
	colours: FeatureColours
): string {
	const filled = isArealGeometryType(feature.geometry.type);
	const subpaths = collectLines(feature.geometry)
		.filter((line) => line.length >= 2)
		.map((line) => `${svgPathCommandsForLine(line, project)}${filled ? ' Z' : ''}`);
	if (subpaths.length === 0) {
		return '';
	}
	const fillAttributes = filled ? `fill="${colours.fill}" fill-opacity="${colours.fillOpacity}"` : 'fill="none"';
	return `<path d="${subpaths.join(' ')}" ${fillAttributes} stroke="${colours.stroke}" stroke-width="2"/>`;
}

/**
 * Rough centroid of a feature's first ring (or the point itself) — used for
 * numbered badges that tie static-map polygons to the fallback legend.
 */
export function centroidOfGeometry(geometry: Geometry): Position | undefined {
	const ring =
		geometry.type === 'Polygon'
			? geometry.coordinates[0]
			: geometry.type === 'MultiPolygon'
				? geometry.coordinates[0]?.[0]
				: undefined;
	if (geometry.type === 'Point') {
		return geometry.coordinates;
	}
	if (!ring?.length) {
		return collectLines(geometry)[0]?.[0];
	}
	let lng = 0;
	let lat = 0;
	for (const [x, y] of ring) {
		lng += x;
		lat += y;
	}
	return [lng / ring.length, lat / ring.length];
}

/**
 * Vector overlays only (transparent background) — for compositing on top of a
 * raster basemap when encoding to AVIF/WebP/PNG via sharp.
 */
export function renderStaticMapOverlaySvg(options: StaticMapBuildOptions): string {
	const width = options.width ?? MAP_VIEWPORT.width;
	const height = options.height ?? MAP_VIEWPORT.height;
	const zoom = Math.round(options.zoom);
	const { left, top } = staticMapViewportOrigin(options.center, zoom, width, height);

	const project = (lng: number, lat: number): [number, number] => {
		const [worldX, worldY] = lngLatToWorldPixel(lng, lat, zoom);
		return [worldX - left, worldY - top];
	};

	const consulteePaths = options.consulteeGeojson.features
		.map((feature) => pathForFeature(feature, project, consulteeColours(feature)))
		.filter(Boolean)
		.join('\n');
	const projectPaths = options.projectGeojson.features
		.map((feature) => pathForFeature(feature, project, PROJECT_COLOUR))
		.filter(Boolean)
		.join('\n');

	const markerMarkup = (options.markers ?? [])
		.map(({ coords, label }) => {
			const [x, y] = project(coords[0], coords[1]);
			const labelMarkup = label
				? `<text x="0" y="14" text-anchor="middle" font-size="12" font-weight="600" fill="#0b0c0c" stroke="#ffffff" stroke-width="3" paint-order="stroke">${escapeXml(label)}</text>`
				: '';
			return (
				`<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">` +
				'<path d="M0 0C-5.5-6.5-9-10.5-9-15a9 9 0 1 1 18 0c0 4.5-3.5 8.5-9 15z" fill="#1d70b8" stroke="#ffffff" stroke-width="1.5"/>' +
				'<circle cy="-14.5" r="3.5" fill="#ffffff"/>' +
				labelMarkup +
				'</g>'
			);
		})
		.join('\n');

	const badgeMarkup = (options.featureBadges ?? [])
		.map(({ coords, label, fill }) => {
			const [x, y] = project(coords[0], coords[1]);
			// fill lands inside an SVG attribute - only hex colours are valid; anything else
			// falls back rather than interpolating (same rule as consulteeColours)
			const badgeFill = typeof fill === 'string' && /^#[0-9a-f]{6}$/i.test(fill) ? fill : '#0b0c0c';
			return (
				`<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">` +
				`<circle r="9" fill="${badgeFill}" stroke="#ffffff" stroke-width="1.5"/>` +
				`<text y="3.5" text-anchor="middle" font-size="10" font-weight="700" fill="#ffffff">${escapeXml(label)}</text>` +
				'</g>'
			);
		})
		.join('\n');

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${consulteePaths}
  ${projectPaths}
  ${markerMarkup}
  ${badgeMarkup}
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="none" stroke="#b1b4b6"/>
</svg>`;
}

/**
 * Render SVG with an optional pre-composited basemap image (see
 * `renderSvgBasemapImage` - a single compressed image, never raw tiles).
 * When tile fetch fails, polygons still draw on a plain background.
 */
export function renderStaticMapSvg(options: StaticMapBuildOptions, basemapImage?: Buffer): string {
	const width = options.width ?? MAP_VIEWPORT.width;
	const height = options.height ?? MAP_VIEWPORT.height;

	// href only - xlink:href is deprecated and doubles the embedded payload
	const basemapMarkup = basemapImage
		? `<image href="data:image/jpeg;base64,${basemapImage.toString('base64')}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>`
		: '';

	const title = escapeXml(options.title ?? 'Static map of project site and consultee areas');
	const desc = escapeXml(options.description ?? title);

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${title}</title>
  <desc id="desc">${desc}</desc>
  <rect width="100%" height="100%" fill="#f5f5f0"/>
  ${basemapMarkup}
  ${renderStaticMapOverlaySvg({ ...options, width, height })}
</svg>
`;
}

/** @deprecated Prefer {@link renderStaticMapSvg} with OSM tiles via the static-map handler. */
export function buildStaticMapSvg(options: {
	center: LngLat;
	zoom: number;
	projectGeojson: GeoJsonFeatureCollection;
	consulteeGeojson: GeoJsonFeatureCollection;
	width?: number;
	height?: number;
}): string {
	return renderStaticMapSvg(options);
}
