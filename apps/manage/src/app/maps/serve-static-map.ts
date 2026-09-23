/**
 * Assemble a cached static-map HTTP response (Google PNG or OSM+SVG).
 */

import {
	buildGoogleStaticMapUrl,
	fetchOsmBasemapTiles,
	googleMapsApiKeyFromEnv,
	renderStaticMapSvg,
	type StaticMapBuildOptions
} from './static-map.ts';
import {
	STATIC_MAP_CACHE_CONTROL,
	buildStaticMapFingerprint,
	etagFromFingerprint,
	etagMatches,
	type StaticMapFingerprintInput
} from './static-map-cache.ts';

export type StaticMapResponseBody = {
	status: number;
	body: Buffer | string;
	contentType: string;
	cacheControl: string;
	etag: string;
};

export type BuildConsulteeStaticMapOptions = {
	geometryId: string;
	sectionId: string;
	map: StaticMapBuildOptions;
	forceSvg?: boolean;
	googleMapsApiKey?: string;
	fetchImpl?: typeof fetch;
	ifNoneMatch?: string;
};

export async function buildConsulteeStaticMapResponse(
	options: BuildConsulteeStaticMapOptions
): Promise<StaticMapResponseBody> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const googleMapsApiKey = options.googleMapsApiKey ?? googleMapsApiKeyFromEnv();
	const forceSvg = options.forceSvg === true;
	const preferGoogle = !forceSvg && Boolean(googleMapsApiKey);
	const width = options.map.width ?? 960;
	const height = options.map.height ?? 516;

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
		preferGoogle
	};
	const etag = etagFromFingerprint(buildStaticMapFingerprint(fingerprintInput));

	if (etagMatches(options.ifNoneMatch, etag)) {
		return {
			status: 304,
			body: Buffer.alloc(0),
			contentType: preferGoogle ? 'image/png' : 'image/svg+xml; charset=utf-8',
			cacheControl: STATIC_MAP_CACHE_CONTROL,
			etag
		};
	}

	const buildOptions: StaticMapBuildOptions = {
		...options.map,
		width,
		height,
		googleMapsApiKey
	};

	if (!forceSvg) {
		const googleUrl = buildGoogleStaticMapUrl(buildOptions);
		if (googleUrl) {
			try {
				const response = await fetchImpl(googleUrl);
				if (response.ok) {
					return {
						status: 200,
						body: Buffer.from(await response.arrayBuffer()),
						contentType: 'image/png',
						cacheControl: STATIC_MAP_CACHE_CONTROL,
						etag
					};
				}
			} catch {
				// Fall through to OSM/SVG when Google is unreachable.
			}
		}
	}

	const basemapTiles = await fetchOsmBasemapTiles(buildOptions, fetchImpl);
	const svg = renderStaticMapSvg(buildOptions, basemapTiles);
	return {
		status: 200,
		body: svg,
		contentType: 'image/svg+xml; charset=utf-8',
		cacheControl: STATIC_MAP_CACHE_CONTROL,
		etag
	};
}
