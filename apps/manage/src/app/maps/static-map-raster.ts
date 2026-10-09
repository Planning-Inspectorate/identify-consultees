/**
 * Raster encoding for static maps: composite OSM basemap tiles + the vector
 * overlay (project / consultee polygons) and encode to AVIF / WebP / PNG.
 *
 * The negotiated format comes from the request `Accept` header — browsers
 * declare their supported formats on <img> fetches, so a single URL serves
 * both the <noscript> and JS-fallback paths. PNG remains the safe default.
 */

import sharp from 'sharp';
import { MAP_VIEWPORT } from './sample-geojson.ts';
import { renderStaticMapOverlaySvg, type OsmBasemapTile, type StaticMapBuildOptions } from './static-map.ts';

export type StaticMapFormat = 'avif' | 'webp' | 'png';

export const STATIC_MAP_CONTENT_TYPES: Record<StaticMapFormat, string> = {
	avif: 'image/avif',
	webp: 'image/webp',
	png: 'image/png'
};

const BASEMAP_BACKGROUND = '#f5f5f0';

/**
 * Pick the best raster format the client accepts, preferring the smallest
 * (avif → webp → png). Entries with `q=0` are honourably skipped; a missing
 * header or wildcard-only Accept → png.
 */
export function negotiateStaticMapFormat(acceptHeader: string | undefined): StaticMapFormat {
	const accepted = new Set(
		(acceptHeader ?? '')
			.split(',')
			.map((part) => {
				const [type, ...params] = part.split(';');
				const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
				return { type: type.trim().toLowerCase(), q: qParam ? Number(qParam.slice(2)) : 1 };
			})
			.filter((entry) => entry.type !== '' && entry.q > 0)
			.map((entry) => entry.type)
	);
	if (accepted.has('image/avif')) {
		return 'avif';
	}
	if (accepted.has('image/webp')) {
		return 'webp';
	}
	return 'png';
}

/**
 * Composite the fetched tiles into one compressed image for embedding in the
 * SVG static-map variant. Embedding raw PNG tiles balloons the document
 * (~900KB for a typical viewport, over the static-map size budget in AGENTS.md);
 * a single JPEG keeps the .svg route small while the overlay stays vector.
 * JPEG over WebP here because SVG `<image>` decoders outside browsers
 * (librsvg, document converters) may not support WebP.
 * Returns undefined when there are no tiles - the SVG's flat background suffices.
 */
export async function renderSvgBasemapImage(
	options: Pick<StaticMapBuildOptions, 'width' | 'height'>,
	basemapTiles: OsmBasemapTile[]
): Promise<Buffer | undefined> {
	if (basemapTiles.length === 0) {
		return undefined;
	}
	const width = options.width ?? MAP_VIEWPORT.width;
	const height = options.height ?? MAP_VIEWPORT.height;
	return sharp({
		create: { width, height, channels: 3, background: BASEMAP_BACKGROUND }
	})
		.composite(
			basemapTiles.map((tile) => ({
				input: tile.png,
				left: Math.round(tile.x),
				top: Math.round(tile.y)
			}))
		)
		.jpeg({ quality: 70 })
		.toBuffer();
}

/**
 * Encode a basemap + vector overlay to the requested raster format.
 * `basemapPng` is a pre-composited basemap (e.g. a Google Static Maps PNG);
 * when absent the fetched OSM tiles are composited instead.
 */
export async function renderStaticMapRaster(
	options: StaticMapBuildOptions,
	format: StaticMapFormat,
	basemapTiles: OsmBasemapTile[] = [],
	basemapPng?: Buffer
): Promise<Buffer> {
	const width = options.width ?? MAP_VIEWPORT.width;
	const height = options.height ?? MAP_VIEWPORT.height;

	// one composite() call — sharp replaces (not appends) the input list on
	// successive calls, which would silently drop the basemap tiles
	const base = basemapPng
		? sharp(basemapPng).resize(width, height, { fit: 'fill' })
		: sharp({
				create: {
					width,
					height,
					channels: 3,
					background: BASEMAP_BACKGROUND
				}
			});

	const overlay = Buffer.from(renderStaticMapOverlaySvg({ ...options, width, height }));

	const composite = base.composite([
		...basemapTiles.map((tile) => ({
			input: tile.png,
			left: Math.round(tile.x),
			top: Math.round(tile.y)
		})),
		{ input: overlay, left: 0, top: 0 }
	]);

	switch (format) {
		case 'avif':
			return composite.avif({ quality: 50 }).toBuffer();
		case 'webp':
			return composite.webp({ quality: 80 }).toBuffer();
		case 'png':
			return composite.png({ compressionLevel: 9 }).toBuffer();
	}
}
