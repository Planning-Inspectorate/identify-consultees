/**
 * Server-side static map generation for progressive enhancement.
 *
 * Prefer Google Maps Static API (PNG) when `GOOGLE_MAPS_API_KEY` is set.
 * Otherwise render SVG with OpenStreetMap raster tiles (PNG) embedded as
 * data URIs, plus the same project / consultee polygons as the interactive map.
 *
 * Tile and static-image upstreams must be used sparingly — see AGENTS.md.
 */

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
};

const GOOGLE_STATIC_MAP_MAX_URL_LENGTH = 16_384;
const OSM_TILE_SIZE = 256;
const OSM_USER_AGENT = 'identify-consultees/0.1 (+https://github.com/Planning-Inspectorate/identify-consultees)';
const OSM_TILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const OSM_TILE_FETCH_CONCURRENCY = 2;

const PROJECT_COLOUR = { stroke: '#C44E52', fill: '#C44E52', googleFill: '0xC44E5266', googleStroke: '0xC44E52FF' };
const CONSULTEE_COLOUR = { stroke: '#55A868', fill: '#55A868', googleFill: '0x55A86866', googleStroke: '0x55A868FF' };

type CachedTile = { png: Buffer; expiresAt: number };
const osmTileCache = new Map<string, CachedTile>();

export function clearOsmTileCacheForTests(): void {
	osmTileCache.clear();
}

export function osmTileCacheSizeForTests(): number {
	return osmTileCache.size;
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

function readCachedTile(key: string): Buffer | undefined {
	const entry = osmTileCache.get(key);
	if (!entry) {
		return undefined;
	}
	if (entry.expiresAt <= Date.now()) {
		osmTileCache.delete(key);
		return undefined;
	}
	return entry.png;
}

function writeCachedTile(key: string, png: Buffer): void {
	osmTileCache.set(key, { png, expiresAt: Date.now() + OSM_TILE_CACHE_TTL_MS });
}

/**
 * Fetch OSM raster tiles for a viewport, reusing the in-process tile cache.
 * Low concurrency and identifying User-Agent follow OSM tile usage policy.
 */
export async function fetchOsmBasemapTiles(
	options: Pick<StaticMapBuildOptions, 'center' | 'zoom' | 'width' | 'height'>,
	fetchImpl: typeof fetch = fetch
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
				const cached = readCachedTile(key);
				if (cached) {
					return { ...tile, png: cached } satisfies OsmBasemapTile;
				}

				const url = `https://tile.openstreetmap.org/${zoom}/${tile.tileX}/${tile.tileY}.png`;
				try {
					const response = await fetchImpl(url, {
						headers: { 'User-Agent': OSM_USER_AGENT, Accept: 'image/png' }
					});
					if (!response.ok) {
						return undefined;
					}
					const png = Buffer.from(await response.arrayBuffer());
					writeCachedTile(key, png);
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
		appendGooglePath(params, feature, CONSULTEE_COLOUR);
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
	const ring = feature.geometry.coordinates[0];
	if (!ring || ring.length < 3) {
		return;
	}
	const encoded = encodeGooglePolyline(ring);
	params.append('path', `fillcolor:${colours.googleFill}|color:${colours.googleStroke}|weight:2|enc:${encoded}`);
}

export function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function pathForFeature(
	feature: GeoJsonFeature,
	project: (lng: number, lat: number) => [number, number],
	colours: { fill: string; stroke: string }
): string {
	const ring = feature.geometry.coordinates[0];
	if (!ring || ring.length < 3) {
		return '';
	}
	const commands: string[] = [];
	for (let i = 0; i < ring.length; i += 1) {
		const point = ring[i];
		if (point?.[0] === undefined || point?.[1] === undefined) {
			continue;
		}
		const [x, y] = project(point[0], point[1]);
		commands.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
	}
	commands.push('Z');
	return `<path d="${commands.join(' ')}" fill="${colours.fill}" stroke="${colours.stroke}" stroke-width="2" fill-opacity="0.45"/>`;
}

/**
 * Render SVG with optional OSM PNG tiles as a basemap.
 * When tile fetch fails, polygons still draw on a plain background.
 */
export function renderStaticMapSvg(options: StaticMapBuildOptions, basemapTiles: OsmBasemapTile[] = []): string {
	const width = options.width ?? MAP_VIEWPORT.width;
	const height = options.height ?? MAP_VIEWPORT.height;
	const zoom = Math.round(options.zoom);
	const { left, top } = staticMapViewportOrigin(options.center, zoom, width, height);

	const project = (lng: number, lat: number): [number, number] => {
		const [worldX, worldY] = lngLatToWorldPixel(lng, lat, zoom);
		return [worldX - left, worldY - top];
	};

	const basemapMarkup = basemapTiles
		.map((tile) => {
			const href = `data:image/png;base64,${tile.png.toString('base64')}`;
			return `<image href="${href}" xlink:href="${href}" x="${tile.x.toFixed(1)}" y="${tile.y.toFixed(1)}" width="${OSM_TILE_SIZE}" height="${OSM_TILE_SIZE}" preserveAspectRatio="none"/>`;
		})
		.join('\n');

	const consulteePaths = options.consulteeGeojson.features
		.map((feature) => pathForFeature(feature, project, CONSULTEE_COLOUR))
		.filter(Boolean)
		.join('\n');
	const projectPaths = options.projectGeojson.features
		.map((feature) => pathForFeature(feature, project, PROJECT_COLOUR))
		.filter(Boolean)
		.join('\n');

	const title = escapeXml(options.title ?? 'Static map of project site and consultee areas');
	const desc = escapeXml(options.description ?? title);

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${title}</title>
  <desc id="desc">${desc}</desc>
  <rect width="100%" height="100%" fill="#f5f5f0"/>
  ${basemapMarkup}
  ${consulteePaths}
  ${projectPaths}
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="none" stroke="#b1b4b6"/>
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
