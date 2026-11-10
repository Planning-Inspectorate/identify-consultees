/**
 * The maps' basemap from Ordnance Survey's OS Maps API: its Light style, in Web Mercator (Light_3857),
 * so it fits the interactive maps (MapLibre) and the static ones (see static-map.ts) as OpenStreetMap
 * does. Needs OS_MAPS_API_KEY - the environment's Key Vault secret consultees-os-maps-api-key, from
 * an OS Data Hub project with the OS Maps API. Without it every map stays on OpenStreetMap.
 *
 * The key never reaches the browser: the interactive maps fetch their tiles from this app
 * (/maps/os/tiles/{z}/{x}/{y}.png, behind sign-in), which fetches them from OS with the key in a
 * header, so it isn't in a URL or a log either.
 */
import { fetchWithTimeout } from '@planning-inspectorate/core/util';
import type { IRouter, Request, Response } from 'express';
import { Router as createRouter } from 'express';

const OS_TILE_URL = 'https://api.os.uk/maps/raster/v1/zxy/Light_3857';

/** OS's Web Mercator tiles: zooms 7 to 20, of Great Britain only - OS refuses any other. */
export const OS_MIN_ZOOM = 7;
export const OS_MAX_ZOOM = 20;
/** The area OS's Web Mercator tiles cover: [west, south, east, north]. */
export const OS_BOUNDS: readonly [number, number, number, number] = [-10.76418, 49.528423, 1.9134116, 61.331151];

// a slow or dead OS mustn't stall a page or a report
const OS_TILE_FETCH_TIMEOUT_MS = 10_000;
// OS says tiles keep for a day (its own Cache-Control)
const TILE_CACHE_CONTROL = 'private, max-age=86400';

/**
 * OS_MAPS_API_KEY, if it's a real key: not Terraform's placeholder for a secret still to be filled
 * in, nor a Key Vault reference App Service couldn't resolve.
 */
export function osMapsApiKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const key = env.OS_MAPS_API_KEY?.trim();
	if (!key || key === '<terraform_placeholder>' || key.startsWith('@Microsoft.KeyVault(')) {
		return undefined;
	}
	return key;
}

/**
 * The credit OS's licence asks for on a map drawn on its data, under the Public Sector Geospatial
 * Agreement: "© Crown copyright and database rights <year> OS", then PINS's licence number,
 * OS_LICENCE_NUMBER (an AC0000... number), once it's set.
 */
export function osCredit(env: NodeJS.ProcessEnv = process.env, year = new Date().getFullYear()): string {
	const licence = env.OS_LICENCE_NUMBER?.trim();
	return `© Crown copyright and database rights ${year} OS${licence ? ` ${licence}` : ''}`;
}

/** A map's view: its centre and zoom (on 256px tiles), and its size in pixels. */
export interface MapView {
	center: readonly [number, number];
	zoom: number;
	width: number;
	height: number;
}

/** A point's position in Web Mercator pixels at `zoom`, on 256px tiles. */
function worldPixel([lng, lat]: readonly [number, number], zoom: number): [number, number] {
	const scale = 256 * 2 ** zoom;
	const sinLat = Math.sin((lat * Math.PI) / 180);
	return [((lng + 180) / 360) * scale, (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale];
}

/**
 * Whether OS has tiles for the whole of a map's view - a zoom from 7 to 20, and nothing beyond Great
 * Britain's extent, which stops at about 1.9°E: an offshore site in the North Sea isn't covered,
 * and is drawn on OpenStreetMap instead, rather than half on a blank background.
 */
export function osCoversView({ center, zoom, width, height }: MapView): boolean {
	if (zoom < OS_MIN_ZOOM || zoom > OS_MAX_ZOOM) {
		return false;
	}
	const [west, south, east, north] = OS_BOUNDS;
	const [x, y] = worldPixel(center, zoom);
	const [left, top] = worldPixel([west, north], zoom);
	const [right, bottom] = worldPixel([east, south], zoom);
	return x - width / 2 >= left && x + width / 2 <= right && y - height / 2 >= top && y + height / 2 <= bottom;
}

/** One OS tile's PNG, or undefined if OS refused it or couldn't be reached. */
export async function fetchOsTile(key: string, zoom: number, x: number, y: number): Promise<Buffer | undefined> {
	try {
		const response = await fetchWithTimeout(
			`${OS_TILE_URL}/${zoom}/${x}/${y}.png`,
			{ timeoutMs: OS_TILE_FETCH_TIMEOUT_MS },
			{ headers: { key, Accept: 'image/png' } }
		);
		return response.ok ? Buffer.from(await response.arrayBuffer()) : undefined;
	} catch {
		return undefined;
	}
}

/** The basemap the interactive maps are drawn on - consultees-map.js passes it to InteractiveMap. */
export interface InteractiveBasemap {
	url: string;
	attribution: string;
	backgroundColor: string;
	/** MapLibre's zoom range - its zoom levels are 512px, so one less than OS's 256px tiles. */
	minZoom?: number;
	maxZoom?: number;
	/** [west, south, east, north] the map can be panned within. */
	maxExtent?: readonly [number, number, number, number];
}

/**
 * The interactive maps' basemap, `{ interactiveBasemap }` for a map's page config: OS's Light style when
 * there's a key and OS covers the map's opening `view`, as its static image is drawn. Nothing
 * otherwise - consultees-map.js then draws on OpenFreeMap, as before.
 */
export function interactiveBasemap(
	view: MapView,
	env: NodeJS.ProcessEnv = process.env
): { interactiveBasemap?: InteractiveBasemap } {
	if (!osMapsApiKeyFromEnv(env) || !osCoversView(view)) {
		return {};
	}
	return {
		interactiveBasemap: {
			url: '/maps/os/style.json',
			attribution: osCredit(env),
			backgroundColor: '#f5f5f5',
			minZoom: OS_MIN_ZOOM - 1,
			maxZoom: OS_MAX_ZOOM - 1,
			maxExtent: OS_BOUNDS
		}
	};
}

/**
 * A MapLibre style with OS's tiles as its one layer, served through this app. Glyphs stay
 * OpenFreeMap's, as before, for any label a map layer draws.
 */
export function osStyle(): object {
	return {
		version: 8,
		name: 'OS Light',
		glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
		sources: {
			os: {
				type: 'raster',
				tiles: ['/maps/os/tiles/{z}/{x}/{y}.png'],
				tileSize: 256,
				minzoom: OS_MIN_ZOOM,
				maxzoom: OS_MAX_ZOOM,
				bounds: [...OS_BOUNDS]
			}
		},
		layers: [{ id: 'os', type: 'raster', source: 'os' }]
	};
}

type TileFetcher = typeof fetchOsTile;

/**
 * /maps/os: the interactive maps' OS style and tiles. Mounted behind sign-in (see router.ts), only
 * while there's a key. A tile OS hasn't got, or can't send, is a 404 or 502 - MapLibre leaves that
 * square blank and asks again when the map moves.
 */
export function createOsMapRoutes(key: string, fetchTile: TileFetcher = fetchOsTile): IRouter {
	const router = createRouter();

	router.get('/style.json', (_req, res) => {
		res.set('Cache-Control', 'private, max-age=3600').json(osStyle());
	});

	router.get('/tiles/:z/:x/:y.png', async (req: Request, res: Response) => {
		const [zoom, x, y] = [req.params.z, req.params.x, req.params.y].map((value) =>
			/^\d{1,7}$/.test(String(value)) ? Number(value) : Number.NaN
		);
		const tiles = 2 ** zoom;
		if (!(zoom >= OS_MIN_ZOOM && zoom <= OS_MAX_ZOOM) || !(x < tiles) || !(y < tiles)) {
			res.status(404).end();
			return;
		}
		const png = await fetchTile(key, zoom, x, y);
		if (!png) {
			res.status(502).end();
			return;
		}
		res.set('Cache-Control', TILE_CACHE_CONTROL).type('image/png').send(png);
	});

	return router;
}
