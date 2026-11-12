import { BoundedCache } from '#util/bounded-cache.ts';
import type { PrismaClient } from '@pins/identify-consultees-database/src/client/client.ts';
import { bufferGeometryForDisplay } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import type { Geometry } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';
import { createHash } from 'node:crypto';

/**
 * A site grown by a distance, as the maps draw it (bufferGeometryForDisplay) - the search area and
 * each of a category's buffers - kept between requests. Every category page of a case, and its
 * report, grows the same site by the same distances: on the largest site, 1.1s for the 20km search
 * area and 0.6s more for a category's buffers, each time. The key is the site's geometry itself, by
 * its hash, so a boundary replaced under the same id is grown afresh; nothing else changes what
 * growing it gives.
 */

// each is a display geometry, simplified - tens of kilobytes for the largest sites
const MAX_GROWN_SITES = 200;
const GROWN_SITE_TTL_MS = 24 * 60 * 60 * 1000;

// one cache per database client, so a test's stand-in client never sees another's
const caches = new WeakMap<PrismaClient, BoundedCache<Promise<Geometry>>>();

function cacheFor(db: PrismaClient): BoundedCache<Promise<Geometry>> {
	let cache = caches.get(db);
	if (!cache) {
		cache = new BoundedCache({ maxEntries: MAX_GROWN_SITES, ttlMs: GROWN_SITE_TTL_MS });
		caches.set(db, cache);
	}
	return cache;
}

/** `site` grown by `metres`, from the cache where it's been grown before. A failure isn't kept. */
export function grownSite(db: PrismaClient, site: Geometry, metres: number): Promise<Geometry> {
	const cache = cacheFor(db);
	const key = `${createHash('sha256').update(JSON.stringify(site)).digest('base64url')}:${metres}`;
	const cached = cache.get(key);
	if (cached) {
		return cached;
	}
	const grown = bufferGeometryForDisplay(db, site, metres);
	cache.set(key, grown);
	grown.catch(() => cache.delete(key));
	return grown;
}
