import { COMPRESSIBLE_EXTENSIONS } from '#util/fingerprint-assets.ts';
import {
	buildStaticAssetsRateLimiter,
	contentTypeFor,
	preferredEncoding,
	staticAssetRequestKey
} from '#util/static-assets-middleware.ts';
import { DEFRA_VENDOR_ROOTS } from '#util/vendor-assets.ts';
import type { IRouter, Request, RequestHandler, Response } from 'express';
import express, { Router as createRouter } from 'express';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { brotliCompress, constants as zlibConstants } from 'node:zlib';
import { etagMatches } from './static-map-cache.ts';

export type DefraVendorRouterOptions = {
	/**
	 * Cache lifetime for the un-fingerprinted files under each mount (webpack
	 * lazy chunks, LICENSE files). Entry points (index.js / index.css) are
	 * fingerprinted copies in the static dir and are served by the static-assets
	 * middleware with an immutable lifetime instead — these URLs must stay
	 * un-immutable because their names do not change between releases.
	 */
	maxAge?: string | number;
	/** Rate limiter for the filesystem-backed vendor responses (tests inject a no-op). */
	rateLimiter?: RequestHandler;
};

/**
 * Quality 9 balances first-hit CPU against size on multi-MB webpack chunks;
 * the result is memoised per file so each chunk is compressed once per process.
 */
const VENDOR_BROTLI_QUALITY = 9;
/** Files this small compress to little gain — not worth a separate br variant. */
const MIN_BROTLI_BYTES = 1024;

const compressAsync = promisify(brotliCompress);

type CompressFn = (input: Buffer) => Promise<Buffer | undefined>;

/**
 * In-process cache of compressed vendor files. The key embeds path + size +
 * mtime so a changed file naturally produces a new variant; `latestKeyByPath`
 * evicts the previous variant for the same file so the map stays bounded.
 */
const brotliVariants = new Map<string, Promise<Buffer | undefined>>();
const latestKeyByPath = new Map<string, string>();

export function clearVendorBrotliCacheForTests(): void {
	brotliVariants.clear();
	latestKeyByPath.clear();
}

const MAX_AGE_UNITS: Record<string, number> = {
	ms: 1,
	s: 1000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000
};

/**
 * Convert an express.static-style maxAge (ms number or `ms`-style string such
 * as '1d' / '12h' / '30m') into `Cache-Control` seconds. Unknown strings fall
 * back to 0 (always revalidate) rather than caching for a wrong duration.
 */
export function maxAgeToSeconds(maxAge: string | number | undefined): number {
	if (typeof maxAge === 'number') {
		return Math.max(0, Math.floor(maxAge / 1000));
	}
	const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i.exec(maxAge?.trim() ?? '');
	if (!match) {
		return 0;
	}
	const ms = Number(match[1]) * MAX_AGE_UNITS[(match[2] ?? 'ms').toLowerCase()];
	return Math.floor(ms / 1000);
}

function weakEtagFor(size: number, mtimeMs: number): string {
	return `W/"${size}-${Math.floor(mtimeMs / 1000) * 1000}"`;
}

async function compressedVariant(absolutePath: string, compress: CompressFn): Promise<Buffer | undefined> {
	return compress(await readFile(absolutePath));
}

/**
 * Memoised compression — a stampede of requests for the same chunk shares one
 * encode, and a changed file (mtime/size drift) recompresses on next hit.
 */
function getBrotliVariant(
	absolutePath: string,
	size: number,
	mtimeMs: number,
	compress: CompressFn
): Promise<Buffer | undefined> {
	const key = `${absolutePath}:${size}:${mtimeMs}`;
	const existing = brotliVariants.get(key);
	if (existing) {
		return existing;
	}
	// an identical key would have returned from `existing` above, so a recorded
	// previous key is always a stale variant for a changed file
	const previousKey = latestKeyByPath.get(absolutePath);
	if (previousKey) {
		brotliVariants.delete(previousKey);
	}
	latestKeyByPath.set(absolutePath, key);
	const pending = compressedVariant(absolutePath, compress);
	// attach a noop rejection handler so a failed encode is not reported as an
	// unhandled rejection before the next requester awaits the cached promise
	pending.catch(() => {});
	brotliVariants.set(key, pending);
	return pending;
}

/**
 * Serve a precompressed variant of a vendor file negotiated from
 * Accept-Encoding. The build writes `.br`/`.gz` sidecars beside each file; a
 * sidecar is used only while it is not older than its source — an in-place
 * package update or a deps:patch-* rewrite makes it stale, and the memoised
 * runtime Brotli encode (or the plain file) takes over until the next build.
 * Requests with no usable variant fall through to the express.static mount,
 * which keeps its exact 404/ETag/Cache-Control behaviour.
 */
export function createVendorCompressedHandler(
	root: string,
	maxAge: string | number | undefined,
	options: { compress?: CompressFn } = {}
): RequestHandler {
	const maxAgeSeconds = maxAgeToSeconds(maxAge);
	const compress =
		options.compress ??
		((input: Buffer) =>
			compressAsync(input, {
				params: { [zlibConstants.BROTLI_PARAM_QUALITY]: VENDOR_BROTLI_QUALITY }
			}));

	return async (req: Request, res: Response, next) => {
		const key = req.method === 'GET' || req.method === 'HEAD' ? staticAssetRequestKey(req.path) : null;
		if (key === null) {
			next();
			return;
		}

		const compressible = COMPRESSIBLE_EXTENSIONS.has(path.extname(key).toLowerCase());
		// the response varies on Accept-Encoding for every compressible file,
		// including the plain variant served by express.static after next()
		if (compressible) {
			res.setHeader('Vary', 'Accept-Encoding');
		}
		if (!compressible) {
			next();
			return;
		}

		const absolutePath = path.join(root, key);
		let stats;
		try {
			stats = await stat(absolutePath);
		} catch {
			next();
			return;
		}
		if (!stats.isFile()) {
			next();
			return;
		}

		const freshSidecar = async (extension: string) => {
			const sidecarPath = `${absolutePath}.${extension}`;
			try {
				const sidecarStats = await stat(sidecarPath);
				if (sidecarStats.mtimeMs >= stats.mtimeMs) {
					return { absolutePath: sidecarPath, size: sidecarStats.size };
				}
			} catch {
				return undefined;
			}
			return undefined;
		};
		const [brotliSidecar, gzipSidecar] = await Promise.all([freshSidecar('br'), freshSidecar('gz')]);

		// gzip exists only as a build sidecar; br can also come from the runtime
		// encode, which keeps its size floor
		const encoding = preferredEncoding(req.get('accept-encoding') ?? undefined, {
			br: brotliSidecar !== undefined || stats.size >= MIN_BROTLI_BYTES,
			gzip: gzipSidecar !== undefined
		});
		if (!encoding) {
			next();
			return;
		}

		const etag = weakEtagFor(stats.size, stats.mtimeMs);
		res.setHeader('Content-Type', contentTypeFor(absolutePath));
		res.setHeader('Cache-Control', `public, max-age=${maxAgeSeconds}`);
		res.setHeader('ETag', etag);
		res.setHeader('Last-Modified', new Date(Math.floor(stats.mtimeMs / 1000) * 1000).toUTCString());

		if (etagMatches(req.get('if-none-match') ?? undefined, etag)) {
			res.status(304).end();
			return;
		}

		const sidecar = encoding === 'br' ? brotliSidecar : gzipSidecar;
		if (sidecar) {
			res.setHeader('Content-Encoding', encoding);
			res.setHeader('Content-Length', sidecar.size);
			res.status(200);
			if (req.method === 'HEAD') {
				res.end();
				return;
			}
			try {
				await pipeline(createReadStream(sidecar.absolutePath), res);
			} catch (error) {
				if (!res.headersSent) {
					next(error);
				}
			}
			return;
		}

		try {
			const variant = await getBrotliVariant(absolutePath, stats.size, stats.mtimeMs, compress);
			if (!variant) {
				next();
				return;
			}
			res.setHeader('Content-Encoding', 'br');
			res.setHeader('Content-Length', variant.length);
			res.status(200);
			// res.end (not res.send) so Express does not overwrite the file-based
			// ETag above with a hash of the compressed body; HEAD sends headers only
			res.end(req.method === 'HEAD' ? undefined : variant);
		} catch {
			next();
		}
	};
}

/**
 * Build-time sidecars are negotiation internals, not content: express.static
 * would happily serve `chunk.js.br` as raw bytes, so a request for one misses
 * exactly like a nonexistent asset. staticAssetRequestKey decodes the path so
 * encoded extensions (index.js%2ebr) miss the same way.
 */
const SIDECAR_EXTENSIONS = new Set(['.br', '.gz']);

const rejectSidecarRequests: RequestHandler = (req, _res, next) => {
	const key = staticAssetRequestKey(req.path);
	if (key && SIDECAR_EXTENSIONS.has(path.extname(key).toLowerCase())) {
		next(Object.assign(new Error('Not Found'), { statusCode: 404 }));
		return;
	}
	next();
};

/**
 * Serve Defra Interactive Map UMD/CSS assets from node_modules
 * (same pattern as PINS-data-spike vendor mounts), preferring the build-time
 * `.br`/`.gz` sidecars beside each file and falling back to lazy in-process
 * Brotli when the client accepts `br` and no fresh sidecar exists.
 */
export function createDefraVendorRouter(options: DefraVendorRouterOptions = {}): IRouter {
	const router = createRouter();
	const rateLimiter = options.rateLimiter ?? buildStaticAssetsRateLimiter();

	// the router is mounted at the app root, so without the path check the limiter
	// would count every request through the app - it is for the /vendor mounts only
	router.use((req, res, next) => (req.path.startsWith('/vendor/') ? rateLimiter(req, res, next) : next()));

	for (const [prefix, root] of Object.entries(DEFRA_VENDOR_ROOTS)) {
		router.use(`/vendor/${prefix}`, rejectSidecarRequests);
		router.use(`/vendor/${prefix}`, createVendorCompressedHandler(root, options.maxAge));
		router.use(`/vendor/${prefix}`, express.static(root, { index: false, fallthrough: false, maxAge: options.maxAge }));
	}

	return router;
}
