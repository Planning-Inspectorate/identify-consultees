/**
 * Basemap tiles kept in-process, shared by the static maps (see static-map.ts) and the interactive
 * maps' OS tile route (see os-maps.ts) - one 10-30KB tile fetched once serves every page and map
 * that asks for it.
 */
import { BoundedCache } from '#util/bounded-cache.ts';

// tiles keep for a day, as OS's and OSM's own cache headers allow
const TILE_TTL_MS = 24 * 60 * 60 * 1000;
// the most tiles kept, OS's and OSM's together - each is 10-30KB, so tens of MB at most. A report's
// maps share a view, so a few hundred tiles cover several reports
const MAX_CACHED_TILES = 2_000;
// added to the cache's clock - only ageOsmTileCacheForTests moves it
let tileClockOffsetMs = 0;
const tileCache = new BoundedCache<Buffer>({
	maxEntries: MAX_CACHED_TILES,
	ttlMs: TILE_TTL_MS,
	now: () => Date.now() + tileClockOffsetMs
});

// fetches under way, so simultaneous requests for the same tile share one upstream call
const inFlightTiles = new Map<string, Promise<Buffer | undefined>>();

export function clearOsmTileCacheForTests(): void {
	tileCache.clear();
	inFlightTiles.clear();
}

export function osmTileCacheSizeForTests(): number {
	return tileCache.size;
}

/** Make every tile cached so far older than a day. */
export function ageOsmTileCacheForTests(): void {
	tileClockOffsetMs += TILE_TTL_MS + 1;
}

/**
 * One tile's PNG from the cache, or from `source` on a miss - one fetch shared among the requests
 * asking at once, then kept for the next. A miss fetches every time, so a tile that couldn't be
 * had isn't remembered.
 */
export async function cachedTile(key: string, source: () => Promise<Buffer | undefined>): Promise<Buffer | undefined> {
	const cached = tileCache.get(key);
	if (cached) {
		return cached;
	}
	let pending = inFlightTiles.get(key);
	if (!pending) {
		pending = source();
		inFlightTiles.set(key, pending);
		pending
			.finally(() => {
				inFlightTiles.delete(key);
			})
			.catch(() => {});
	}
	const png = await pending;
	if (png) {
		tileCache.set(key, png);
	}
	return png;
}
