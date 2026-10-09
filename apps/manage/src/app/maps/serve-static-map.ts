/**
 * Assemble a cached static-map HTTP response.
 *
 * Raster path (default): negotiate AVIF → WebP → PNG from `Accept`, composite
 * OSM tiles + vector overlay via sharp (or transcode a Google Static Maps PNG).
 * `forceSvg` keeps the SVG+embedded-tiles output for the explicit `.svg` route.
 */

import type { Response } from 'express';
import {
	STATIC_MAP_CACHE_CONTROL,
	STATIC_MAP_CACHE_CONTROL_PRIVATE,
	buildStaticMapFingerprint,
	etagFromFingerprint,
	etagMatches,
	type StaticMapFingerprintInput
} from './static-map-cache.ts';
import {
	STATIC_MAP_CONTENT_TYPES,
	negotiateStaticMapFormat,
	renderStaticMapRaster,
	type StaticMapFormat
} from './static-map-raster.ts';
import {
	buildGoogleStaticMapUrl,
	fetchOsmBasemapTiles,
	googleMapsApiKeyFromEnv,
	renderStaticMapSvg,
	type StaticMapBuildOptions
} from './static-map.ts';

const SVG_CONTENT_TYPE = 'image/svg+xml; charset=utf-8';
/** Raster variants share one URL — caches must key on the Accept header. */
const VARY_ACCEPT = 'Accept';

export type StaticMapResponseBody = {
	status: number;
	body: Buffer | string;
	contentType: string;
	cacheControl: string;
	etag: string;
	vary?: string;
};

/** Write a built static-map response onto an Express response - shared by every static-map route. */
export function sendStaticMapResponse(res: Response, image: StaticMapResponseBody): void {
	res
		.status(image.status)
		.set({
			'Cache-Control': image.cacheControl,
			ETag: image.etag,
			...(image.vary ? { Vary: image.vary } : {})
		})
		.type(image.contentType);

	if (image.status === 304) {
		res.end();
		return;
	}

	res.send(image.body);
}

export type BuildConsulteeStaticMapOptions = {
	geometryId: string;
	sectionId: string;
	map: StaticMapBuildOptions;
	forceSvg?: boolean;
	googleMapsApiKey?: string;
	fetchImpl?: typeof fetch;
	ifNoneMatch?: string;
	accept?: string;
	/**
	 * True only for images that are safe for shared caches (Front Door) to
	 * serve without a session - i.e. content that isn't access-controlled,
	 * such as the /components showcase examples. Case-derived images must
	 * stay `private` (the default): a shared-cached copy would bypass the
	 * auth guards for anyone holding the URL.
	 */
	sharedCache?: boolean;
};

async function fetchGoogleBasemap(url: string, fetchImpl: typeof fetch): Promise<Buffer | undefined> {
	try {
		const response = await fetchImpl(url);
		if (response.ok) {
			return Buffer.from(await response.arrayBuffer());
		}
	} catch {
		// Fall through to the OSM-tile basemap when Google is unreachable.
	}
	return undefined;
}

export async function buildConsulteeStaticMapResponse(
	options: BuildConsulteeStaticMapOptions
): Promise<StaticMapResponseBody> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const googleMapsApiKey = options.googleMapsApiKey ?? googleMapsApiKeyFromEnv();
	const forceSvg = options.forceSvg === true;
	const format: StaticMapFormat | 'svg' = forceSvg ? 'svg' : negotiateStaticMapFormat(options.accept);
	const preferGoogle = !forceSvg && Boolean(googleMapsApiKey);
	const width = options.map.width ?? 960;
	const height = options.map.height ?? 516;

	const cacheControl = options.sharedCache === true ? STATIC_MAP_CACHE_CONTROL : STATIC_MAP_CACHE_CONTROL_PRIVATE;

	const fingerprintInput: StaticMapFingerprintInput = {
		geometryId: options.geometryId,
		sectionId: options.sectionId,
		center: options.map.center,
		zoom: options.map.zoom,
		projectGeojson: options.map.projectGeojson,
		consulteeGeojson: options.map.consulteeGeojson,
		width,
		height,
		forceSvg,
		preferGoogle,
		format,
		markers: options.map.markers,
		featureBadges: options.map.featureBadges
	};
	const etag = etagFromFingerprint(buildStaticMapFingerprint(fingerprintInput));

	const contentType = format === 'svg' ? SVG_CONTENT_TYPE : STATIC_MAP_CONTENT_TYPES[format];
	// Vary: Accept only applies to the negotiated raster formats
	const vary = format === 'svg' ? undefined : VARY_ACCEPT;

	if (etagMatches(options.ifNoneMatch, etag)) {
		return {
			status: 304,
			body: Buffer.alloc(0),
			contentType,
			cacheControl,
			etag,
			vary
		};
	}

	const buildOptions: StaticMapBuildOptions = {
		...options.map,
		width,
		height,
		googleMapsApiKey
	};

	if (format === 'svg') {
		const basemapTiles = await fetchOsmBasemapTiles(buildOptions, fetchImpl);
		const svg = renderStaticMapSvg(buildOptions, basemapTiles);
		return {
			status: 200,
			body: svg,
			contentType: SVG_CONTENT_TYPE,
			cacheControl,
			etag
		};
	}

	const googleUrl = preferGoogle ? buildGoogleStaticMapUrl(buildOptions) : undefined;
	const basemapPng = googleUrl ? await fetchGoogleBasemap(googleUrl, fetchImpl) : undefined;
	const basemapTiles = basemapPng ? [] : await fetchOsmBasemapTiles(buildOptions, fetchImpl);
	const raster = await renderStaticMapRaster(buildOptions, format, basemapTiles, basemapPng);

	return {
		status: 200,
		body: raster,
		contentType,
		cacheControl,
		etag,
		vary
	};
}
