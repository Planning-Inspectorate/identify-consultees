/**
 * Rendered static-map responses kept in-process, so a repeated request - the browser revalidating
 * the category page's fallback image, or a second session asking for the same map - doesn't pay
 * for display-geometry reads, WKT parsing and upstream basemap work before the answer can be
 * given. Keyed on everything the image is drawn from (URL parameters, the session run's consultee
 * ids and the database's data watermark - see dataWatermark in the database package), so a changed
 * input is a different key, never a stale hit.
 *
 * Only the image's own inputs go in the key, so two sessions whose runs found the same consultees
 * share one rendered map. An entry can be an etag alone: a 304 proves nothing about the body, but
 * is enough to answer another request that's already holding the same etag - the common case for
 * If-None-Match revalidation. Bodies too big or too degraded to share are kept that way (see
 * renderedStaticMap).
 */

import { BoundedCache } from '#util/bounded-cache.ts';
import type { StaticMapResponseBody } from './serve-static-map.ts';
import { etagMatches } from './static-map-cache.ts';

// rendered maps keep for an hour - the same bound the run kept in a session already puts on how
// old the data behind a page can be (RULESET_RUN_MAX_AGE_MS), and the image's private max-age
const MAP_TTL_MS = 60 * 60 * 1000;
// a report has a map for each category; a hundred covers several cases' reports at once
const MAX_CACHED_MAPS = 100;
// and each remembered body at most this big - a forced-SVG render's embedded basemap runs to
// several MB for a big site, so without a bound a hundred of those is hundreds of MB of heap.
// ~100MB worst-case total; an over-size body keeps just its etag, which revalidates all the same
const MAX_CACHED_BODY_BYTES = 1024 * 1024;

interface CachedStaticMap {
	etag: string;
	contentType: string;
	cacheControl: string;
	vary?: string;
	basemap?: StaticMapResponseBody['basemap'];
	/** The image itself - absent when only its etag was seen (a 304 is enough to answer a match). */
	body?: Buffer | string;
}

const renderedMaps = new BoundedCache<CachedStaticMap>({
	maxEntries: MAX_CACHED_MAPS,
	ttlMs: MAP_TTL_MS
});

export function clearStaticMapResponseCacheForTests(): void {
	renderedMaps.clear();
}

export function staticMapResponseCacheSizeForTests(): number {
	return renderedMaps.size;
}

function notModified(cached: CachedStaticMap): StaticMapResponseBody {
	return {
		status: 304,
		body: Buffer.alloc(0),
		contentType: cached.contentType,
		cacheControl: cached.cacheControl,
		etag: cached.etag,
		...(cached.vary ? { vary: cached.vary } : {})
	};
}

/**
 * The map `build` makes for `key`, remembered: a remembered body answers at once, a remembered etag
 * alone answers a matching If-None-Match, and anything `build` returns (200 or 304) is kept for
 * the next request with the same inputs.
 */
export async function renderedStaticMap(
	key: string,
	ifNoneMatch: string | undefined,
	build: (ifNoneMatch: string | undefined) => Promise<StaticMapResponseBody>
): Promise<StaticMapResponseBody> {
	const cached = renderedMaps.get(key);
	if (cached) {
		if (etagMatches(ifNoneMatch, cached.etag)) {
			return notModified(cached);
		}
		if (cached.body !== undefined) {
			return {
				status: 200,
				body: cached.body,
				contentType: cached.contentType,
				cacheControl: cached.cacheControl,
				etag: cached.etag,
				...(cached.vary ? { vary: cached.vary } : {}),
				...(cached.basemap ? { basemap: cached.basemap } : {})
			};
		}
		// an etag alone, not the one the client holds: the image has to be built to be sent
	}

	const built = await build(ifNoneMatch);
	const entry: CachedStaticMap = {
		etag: built.etag,
		contentType: built.contentType,
		cacheControl: built.cacheControl,
		...(built.vary ? { vary: built.vary } : {}),
		...(built.basemap ? { basemap: built.basemap } : {})
	};
	if (built.status === 200) {
		// bodies worth keeping: a degraded one - drawn over missing basemap tiles - stays with the
		// client that got it rather than being served to every session that shares the key, and an
		// over-budget one keeps only its etag. Either way the etag is kept: it comes from the
		// inputs, not the body, so it revalidates whatever the client happens to hold
		const keepBody = built.basemapComplete !== false && Buffer.byteLength(built.body) <= MAX_CACHED_BODY_BYTES;
		renderedMaps.set(key, keepBody ? { ...entry, body: built.body } : entry);
	} else if (built.status === 304) {
		renderedMaps.set(key, entry);
	}
	return built;
}
