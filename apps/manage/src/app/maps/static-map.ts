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
	/** Draw each consultee area's name on it, where there's room - the report's map PDFs. */
	labels?: boolean;
	/** A grey basemap, so the coloured areas stand out on it - the report's map PDFs. Colour by default. */
	basemap?: 'colour' | 'greyscale';
	/**
	 * Outlines drawn dashed and unfilled over the consultee areas, each with its `label` property
	 * written on it - the ruleset's buffers around the site, in the report's map PDFs.
	 */
	bufferGeojson?: GeoJsonFeatureCollection;
	/**
	 * Raster image pixels per map pixel - 1.5 for the report's map PDFs, so they're sharp printed or
	 * zoomed in. The map shows the same area, its lines and text drawn at this scale. 1 by default.
	 */
	pixelRatio?: number;
};

/** The highest zoom OpenStreetMap draws tiles at. */
const OSM_MAX_ZOOM = 19;

/** The size of the image a map renders to: its width and height times its pixel ratio. */
export function outputSize(options: Pick<StaticMapBuildOptions, 'width' | 'height' | 'pixelRatio'>): {
	width: number;
	height: number;
} {
	const ratio = options.pixelRatio ?? 1;
	return {
		width: Math.round((options.width ?? MAP_VIEWPORT.width) * ratio),
		height: Math.round((options.height ?? MAP_VIEWPORT.height) * ratio)
	};
}

/**
 * The tiles a map's basemap is drawn from: OpenStreetMap only has whole zooms, so a map at any other
 * zoom (or pixel ratio) draws the nearest whole one onto a canvas as much larger or smaller, which is
 * then scaled to the image - by at most 1.41 either way.
 */
export function basemapFrame(options: Pick<StaticMapBuildOptions, 'zoom' | 'width' | 'height' | 'pixelRatio'>): {
	zoom: number;
	width: number;
	height: number;
} {
	const output = outputSize(options);
	const exact = options.zoom + Math.log2(options.pixelRatio ?? 1);
	const zoom = Math.min(OSM_MAX_ZOOM, Math.max(0, Math.round(exact)));
	const scale = 2 ** (zoom - exact);
	return { zoom, width: Math.round(output.width * scale), height: Math.round(output.height * scale) };
}

const GOOGLE_STATIC_MAP_MAX_URL_LENGTH = 16_384;
const OSM_TILE_SIZE = 256;
const OSM_USER_AGENT = 'identify-consultees/0.1 (+https://github.com/Planning-Inspectorate/identify-consultees)';
const OSM_TILE_FETCH_CONCURRENCY = 2;
// tiles are small; a slow or dead tile server must not stall the page render
const OSM_TILE_FETCH_TIMEOUT_MS = 10_000;

type FeatureColours = { stroke: string; fill: string; fillOpacity: number; googleFill: string; googleStroke: string };

const PROJECT_COLOUR: FeatureColours = {
	stroke: '#ff0000',
	fill: '#ff0000',
	fillOpacity: 0.2,
	googleFill: '0xFF000033',
	googleStroke: '0xFF0000FF'
};
const CONSULTEE_COLOUR: FeatureColours = {
	stroke: '#55A868',
	fill: '#55A868',
	fillOpacity: 0.45,
	googleFill: '0x55A86866',
	googleStroke: '0x55A868FF'
};

/**
 * A feature's own colour and fill opacity (its `colour` and `fillOpacity` properties), or
 * `fallback` when it has no valid colour.
 */
function featureColours(feature: GeoJsonFeature, fallback: FeatureColours): FeatureColours {
	const colour = feature.properties.colour;
	if (typeof colour !== 'string' || !/^#[0-9a-f]{6}$/i.test(colour)) {
		return fallback;
	}
	const opacity = Number(feature.properties.fillOpacity);
	const fillOpacity = opacity > 0 && opacity <= 1 ? opacity : fallback.fillOpacity;
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

/** A consultee's own category colour and fill opacity, or the default consultee green. */
export function consulteeColours(feature: GeoJsonFeature): FeatureColours {
	return featureColours(feature, CONSULTEE_COLOUR);
}

/**
 * The project's own colour and fill opacity, or red - the boundary page sets the opened file's
 * colour (see config/map-styles/boundary-map.yaml) so the image matches the interactive map.
 */
export function projectColours(feature: GeoJsonFeature): FeatureColours {
	return featureColours(feature, PROJECT_COLOUR);
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
	options: Pick<StaticMapBuildOptions, 'center' | 'zoom' | 'width' | 'height' | 'pixelRatio'>
): Promise<OsmBasemapTile[]> {
	const { zoom, width, height } = basemapFrame(options);
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
		appendGooglePath(params, feature, projectColours(feature));
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

// how far past the map's edge a point counts as off it - more than a 2px stroke reaches
const OFF_MAP_MARGIN_PIXELS = 16;
const LEFT = 1;
const RIGHT = 2;
const ABOVE = 4;
const BELOW = 8;

/** The map edges a pixel lies beyond (bits LEFT, RIGHT, ABOVE, BELOW), or 0 on or near the map. */
function edgesBeyond([x, y]: [number, number], width: number, height: number): number {
	return (
		(x < -OFF_MAP_MARGIN_PIXELS ? LEFT : 0) |
		(x > width + OFF_MAP_MARGIN_PIXELS ? RIGHT : 0) |
		(y < -OFF_MAP_MARGIN_PIXELS ? ABOVE : 0) |
		(y > height + OFF_MAP_MARGIN_PIXELS ? BELOW : 0)
	);
}

/**
 * A line's points in map pixels, leaving out what can't be seen: of each run of points beyond one
 * and the same edge, only its first and last - the straight line between them stays beyond that
 * edge, so what's drawn on the map is unchanged - and any point that rounds to the one before it.
 * A county's coastline is thousands of points, nearly all off a map zoomed in on a site; drawn in
 * full it runs to megabytes of SVG.
 */
export function visiblePathPoints(pixels: [number, number][], width: number, height: number): [number, number][] {
	const kept: [number, number][] = [];
	let run: { first: [number, number]; last: [number, number]; edges: number } | undefined;
	const endRun = () => {
		if (run) {
			kept.push(run.first);
			if (run.last !== run.first) {
				kept.push(run.last);
			}
			run = undefined;
		}
	};
	for (const pixel of pixels) {
		const edges = edgesBeyond(pixel, width, height);
		if (run && (run.edges & edges) !== 0) {
			run.edges &= edges;
			run.last = pixel;
			continue;
		}
		endRun();
		if (edges === 0) {
			kept.push(pixel);
		} else {
			run = { first: pixel, last: pixel, edges };
		}
	}
	endRun();
	return kept;
}

/** A line's points in map pixels, less what can't be seen (see visiblePathPoints). */
function visibleLinePixels(
	line: Position[],
	project: (lng: number, lat: number) => [number, number],
	width: number,
	height: number
): [number, number][] {
	const pixels = line
		.filter((point) => point?.[0] !== undefined && point?.[1] !== undefined)
		.map((point) => project(point[0], point[1]));
	return visiblePathPoints(pixels, width, height);
}

/** Each of a geometry's lines and rings that has a length, in map pixels, less what can't be seen. */
function visibleGeometryPixels(
	geometry: Geometry,
	project: (lng: number, lat: number) => [number, number],
	width: number,
	height: number
): [number, number][][] {
	return collectLines(geometry)
		.filter((line) => line.length >= 2)
		.map((line) => visibleLinePixels(line, project, width, height));
}

function svgPathCommandsForLine(pixels: [number, number][]): string {
	const commands: string[] = [];
	let previous = '';
	for (const [x, y] of pixels) {
		const coordinates = `${x.toFixed(1)} ${y.toFixed(1)}`;
		if (coordinates !== previous) {
			commands.push(`${commands.length === 0 ? 'M' : 'L'}${coordinates}`);
			previous = coordinates;
		}
	}
	return commands.join(' ');
}

function pathForFeature(
	feature: GeoJsonFeature,
	project: (lng: number, lat: number) => [number, number],
	colours: FeatureColours,
	width: number,
	height: number
): string {
	const filled = isArealGeometryType(feature.geometry.type);
	const subpaths = visibleGeometryPixels(feature.geometry, project, width, height).map(
		(pixels) => `${svgPathCommandsForLine(pixels)}${filled ? ' Z' : ''}`
	);
	if (subpaths.length === 0) {
		return '';
	}
	const fillAttributes = filled ? `fill="${colours.fill}" fill-opacity="${colours.fillOpacity}"` : 'fill="none"';
	// the GIS Styling default values give the overlays a 1.5px border (AGENTS.md)
	return `<path d="${subpaths.join(' ')}" ${fillAttributes} stroke="${colours.stroke}" stroke-width="1.5"/>`;
}

// a buffer's outline: dark and dashed, so it reads as a distance rather than as another area
const BUFFER_STROKE = '#0b0c0c';

function bufferPath(
	feature: GeoJsonFeature,
	project: (lng: number, lat: number) => [number, number],
	width: number,
	height: number
): string {
	const subpaths = visibleGeometryPixels(feature.geometry, project, width, height).map(svgPathCommandsForLine);
	return subpaths.length === 0
		? ''
		: `<path d="${subpaths.join(' ')}" fill="none" stroke="${BUFFER_STROKE}" stroke-width="2" stroke-dasharray="8 5"/>`;
}

const LABEL_FONT_SIZE = 11;
// a character's width at that size in a bold sans-serif, near enough to keep labels apart
const LABEL_CHARACTER_WIDTH = 6.4;
const LABEL_HEIGHT = 14;
const LABEL_MAX_CHARACTERS = 40;
// how far apart the spots a label could go are tried, and how far a label keeps from the map's edge
const LABEL_GRID_PIXELS = 12;
const LABEL_EDGE_PIXELS = 4;
// DejaVu Sans is the font the app's image installs (apps/manage/Dockerfile) - Alpine has none
const LABEL_FONT_FAMILY = 'DejaVu Sans, Arial, Helvetica, sans-serif';

type LabelBox = { left: number; top: number; right: number; bottom: number };

/** A name as a label: one line, shortened with an ellipsis past LABEL_MAX_CHARACTERS. */
export function labelText(name: string): string {
	const text = name.replace(/\s+/g, ' ').trim();
	return text.length > LABEL_MAX_CHARACTERS ? `${text.slice(0, LABEL_MAX_CHARACTERS - 1).trimEnd()}…` : text;
}

function labelBox(text: string, [x, y]: [number, number]): LabelBox {
	const halfWidth = (text.length * LABEL_CHARACTER_WIDTH) / 2;
	return { left: x - halfWidth, top: y - LABEL_HEIGHT / 2, right: x + halfWidth, bottom: y + LABEL_HEIGHT / 2 };
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
	return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function onMap(box: LabelBox, width: number, height: number): boolean {
	return (
		box.left >= LABEL_EDGE_PIXELS &&
		box.top >= LABEL_EDGE_PIXELS &&
		box.right <= width - LABEL_EDGE_PIXELS &&
		box.bottom <= height - LABEL_EDGE_PIXELS
	);
}

/** True when a pixel is inside `rings` - even-odd, so a polygon's holes, and a multipolygon's parts, count. */
export function insideRings([x, y]: [number, number], rings: [number, number][][]): boolean {
	let inside = false;
	for (const ring of rings) {
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const [xi, yi] = ring[i];
			const [xj, yj] = ring[j];
			if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
				inside = !inside;
			}
		}
	}
	return inside;
}

/**
 * Where a feature's label could go, best first: for an area, the spots on a grid over the part of
 * it on the map, nearest that part's middle first - so a county covering the whole map is labelled
 * in the open, not off the map where its centroid is; for a line, its points on the map, nearest its
 * middle first; for a point, the point.
 */
function labelSpots(rings: [number, number][][], areal: boolean, width: number, height: number): [number, number][] {
	const points = rings.flat();
	const visible = points.filter(([x, y]) => x >= 0 && y >= 0 && x <= width && y <= height);
	let spots: [number, number][] = visible;
	if (areal) {
		// the part of its bounding box on the map - a loop, as a coastline's points would overflow
		// Math.min(...points)'s arguments
		let [left, top, right, bottom] = [width, height, 0, 0];
		for (const [x, y] of points) {
			left = Math.max(0, Math.min(left, x));
			right = Math.min(width, Math.max(right, x));
			top = Math.max(0, Math.min(top, y));
			bottom = Math.min(height, Math.max(bottom, y));
		}
		spots = [];
		for (let y = Math.ceil(top / LABEL_GRID_PIXELS) * LABEL_GRID_PIXELS; y <= bottom; y += LABEL_GRID_PIXELS) {
			for (let x = Math.ceil(left / LABEL_GRID_PIXELS) * LABEL_GRID_PIXELS; x <= right; x += LABEL_GRID_PIXELS) {
				if (insideRings([x, y], rings)) {
					spots.push([x, y]);
				}
			}
		}
		// smaller than the grid: the middle of its part on the map - for an area off the map, a spot
		// on the map's edge, where no label fits
		if (spots.length === 0) {
			spots = [[(left + right) / 2, (top + bottom) / 2]];
		}
	}
	if (spots.length === 0) {
		return [];
	}
	const middleX = spots.reduce((sum, [x]) => sum + x, 0) / spots.length;
	const middleY = spots.reduce((sum, [, y]) => sum + y, 0) / spots.length;
	const distance = ([x, y]: [number, number]) => (x - middleX) ** 2 + (y - middleY) ** 2;
	return spots.toSorted((a, b) => distance(a) - distance(b));
}

function labelMarkup(text: string, [x, y]: [number, number]): string {
	return (
		`<text x="${x.toFixed(1)}" y="${(y + LABEL_FONT_SIZE * 0.35).toFixed(1)}" text-anchor="middle" ` +
		`font-family="${LABEL_FONT_FAMILY}" font-size="${LABEL_FONT_SIZE}" font-weight="700" fill="#0b0c0c" ` +
		`stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${escapeXml(text)}</text>`
	);
}

/** Where `lines` cross the vertical line at `x`, top to bottom. */
function verticalCrossings(lines: [number, number][][], x: number): number[] {
	const crossings: number[] = [];
	for (const line of lines) {
		for (let i = 1; i < line.length; i++) {
			const [[x1, y1], [x2, y2]] = [line[i - 1], line[i]];
			if (x1 <= x !== x2 <= x) {
				crossings.push(y1 + ((x - x1) * (y2 - y1)) / (x2 - x1));
			}
		}
	}
	return crossings.toSorted((a, b) => a - b);
}

/**
 * Labels for the buffers and the consultee areas, placed so none overlap: each buffer's on its
 * outline above the site (else below it), then each area's name at its best spot that's free - the
 * areas with fewest spots placed first, so a small parish isn't crowded out by the county around
 * it. A name already on the map, or with nowhere free, isn't drawn again - the PDF lists them all.
 */
function renderLabels(
	options: StaticMapBuildOptions,
	project: (lng: number, lat: number) => [number, number],
	width: number,
	height: number
): string {
	const placed: LabelBox[] = [];
	const markup: string[] = [];
	const place = (text: string, spots: [number, number][]): boolean => {
		for (const spot of spots) {
			const box = labelBox(text, spot);
			if (onMap(box, width, height) && !placed.some((other) => overlaps(box, other))) {
				placed.push(box);
				markup.push(labelMarkup(text, spot));
				return true;
			}
		}
		return false;
	};

	for (const feature of options.bufferGeojson?.features ?? []) {
		const label = typeof feature.properties.label === 'string' ? labelText(feature.properties.label) : '';
		const crossings = verticalCrossings(visibleGeometryPixels(feature.geometry, project, width, height), width / 2);
		if (label && crossings.length > 0) {
			// on the outline straight above the site - the map's centre - else straight below it
			place(label, [
				[width / 2, crossings[0]],
				[width / 2, crossings[crossings.length - 1]]
			]);
		}
	}

	if (options.labels) {
		const candidates = options.consulteeGeojson.features
			.map((feature) => ({
				text: labelText(String(feature.properties.name ?? '')),
				spots: labelSpots(
					visibleGeometryPixels(feature.geometry, project, width, height),
					isArealGeometryType(feature.geometry.type),
					width,
					height
				)
			}))
			.filter(({ text, spots }) => text !== '' && spots.length > 0)
			.toSorted((a, b) => a.spots.length - b.spots.length);
		const labelled = new Set<string>();
		for (const { text, spots } of candidates) {
			if (!labelled.has(text) && place(text, spots)) {
				labelled.add(text);
			}
		}
	}
	return markup.join('\n');
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
	// any zoom - the basemap is drawn to match (see basemapFrame)
	const zoom = options.zoom;
	const output = outputSize(options);
	const { left, top } = staticMapViewportOrigin(options.center, zoom, width, height);

	const project = (lng: number, lat: number): [number, number] => {
		const [worldX, worldY] = lngLatToWorldPixel(lng, lat, zoom);
		return [worldX - left, worldY - top];
	};

	const consulteePaths = options.consulteeGeojson.features
		.map((feature) => pathForFeature(feature, project, consulteeColours(feature), width, height))
		.filter(Boolean)
		.join('\n');
	const bufferPaths = (options.bufferGeojson?.features ?? [])
		.map((feature) => bufferPath(feature, project, width, height))
		.filter(Boolean)
		.join('\n');
	const projectPaths = options.projectGeojson.features
		.map((feature) => pathForFeature(feature, project, projectColours(feature), width, height))
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

	// drawn in map pixels, sized in image pixels - a pixel ratio scales every line and label with it
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${output.width}" height="${output.height}" viewBox="0 0 ${width} ${height}">
  ${consulteePaths}
  ${bufferPaths}
  ${projectPaths}
  ${markerMarkup}
  ${badgeMarkup}
  ${renderLabels(options, project, width, height)}
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
  ${renderStaticMapOverlaySvg({ ...options, width, height, pixelRatio: 1 })}
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
