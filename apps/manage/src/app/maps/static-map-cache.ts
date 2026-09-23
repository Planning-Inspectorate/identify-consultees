/**
 * Cache validators for consultee static-map responses.
 *
 * Fingerprints framing + geometry (not basemap tile bytes) so ETag / If-None-Match
 * can skip OpenStreetMap / Google Static Maps upstream work on repeat hits.
 */

import { createHash } from 'node:crypto';

/**
 * Browser/CDN cache for static map images.
 *
 * Heavy caching is required: OSM tile and commercial static-image servers
 * rate-limit aggressive clients. Prefer long reuse plus validators over
 * re-fetching tiles on every noscript / progressive-enhancement hit.
 */
export const STATIC_MAP_CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400';

export type StaticMapFingerprintInput = {
	geometryId: string;
	sectionId: string;
	center: readonly number[];
	zoom: number;
	projectGeojson: unknown;
	consulteeGeojson: unknown;
	width: number;
	height: number;
	forceSvg: boolean;
	preferGoogle: boolean;
};

export function buildStaticMapFingerprint(input: StaticMapFingerprintInput): string {
	const payload = JSON.stringify({
		geometryId: input.geometryId,
		sectionId: input.sectionId,
		center: input.center,
		zoom: input.zoom,
		projectGeojson: input.projectGeojson,
		consulteeGeojson: input.consulteeGeojson,
		width: input.width,
		height: input.height,
		forceSvg: input.forceSvg,
		preferGoogle: input.preferGoogle
	});
	return createHash('sha256').update(payload).digest('hex');
}

export function etagFromFingerprint(fingerprint: string): string {
	return `"${fingerprint.slice(0, 32)}"`;
}

export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
	if (!ifNoneMatch || ifNoneMatch.trim() === '') {
		return false;
	}
	const normalisedEtag = stripWeakEtagPrefix(etag);
	for (const part of ifNoneMatch.split(',')) {
		const candidate = part.trim();
		if (candidate === '*') {
			return true;
		}
		if (stripWeakEtagPrefix(candidate) === normalisedEtag) {
			return true;
		}
	}
	return false;
}

function stripWeakEtagPrefix(value: string): string {
	return value.startsWith('W/') ? value.slice(2) : value;
}
