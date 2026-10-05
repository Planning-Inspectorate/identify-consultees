import type { Handler, Request, RequestHandler, Response } from 'express';
import { Router as createRouter } from 'express';
import rateLimit from 'express-rate-limit';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { isFingerprintedAssetPath } from './fingerprint-assets.ts';

const FINGERPRINTED_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const UNFINGERPRINTED_CACHE_CONTROL = 'public, max-age=86400';

const CONTENT_TYPES: Record<string, string> = {
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.map': 'application/json; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.xml': 'application/xml; charset=utf-8'
};

type IndexedAsset = {
	/** Absolute path discovered at startup (never derived from the request). */
	absolutePath: string;
	/** Optional Brotli sidecar discovered at startup. */
	brotliAbsolutePath?: string;
	/** Weak ETag derived from file size + mtime at startup. */
	etag: string;
	/** HTTP-date string for the Last-Modified header (second precision). */
	lastModified: string;
	/** mtime floored to seconds, for If-Modified-Since comparison. */
	lastModifiedMs: number;
};

export type StaticAssetsRateLimiterOptions = {
	windowMs?: number;
	limit?: number;
};

export type CreateStaticAssetsMiddlewareOptions = {
	rateLimiter?: RequestHandler;
};

export function contentTypeFor(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

export function acceptsBrotli(acceptEncodingHeader: string | undefined): boolean {
	if (!acceptEncodingHeader) {
		return false;
	}
	return acceptEncodingHeader.split(',').some((part) => part.trim().toLowerCase().startsWith('br'));
}

/**
 * Weak ETag comparison for If-None-Match: a list of entity-tags or `*`,
 * where the `W/` prefix is ignored (weak comparison per RFC 9110).
 */
function ifNoneMatchMatches(headerValue: string, etag: string): boolean {
	if (headerValue.trim() === '*') {
		return true;
	}
	const bareEtag = etag.replace(/^W\//, '');
	return headerValue.split(',').some((candidate) => candidate.trim().replace(/^W\//, '') === bareEtag);
}

/**
 * Whether the client's cached copy is still fresh: If-None-Match takes
 * precedence over If-Modified-Since (per RFC 9110 evaluation order).
 */
function isFreshRequest(req: Request, entry: IndexedAsset): boolean {
	const ifNoneMatch = req.get('if-none-match');
	if (ifNoneMatch) {
		return ifNoneMatchMatches(ifNoneMatch, entry.etag);
	}
	const ifModifiedSince = req.get('if-modified-since');
	if (ifModifiedSince) {
		const since = Date.parse(ifModifiedSince);
		return !Number.isNaN(since) && since >= entry.lastModifiedMs;
	}
	return false;
}

function setCacheControl(res: Response, absolutePath: string): void {
	res.setHeader(
		'Cache-Control',
		isFingerprintedAssetPath(absolutePath) ? FINGERPRINTED_CACHE_CONTROL : UNFINGERPRINTED_CACHE_CONTROL
	);
}

/**
 * Limit static asset requests to reduce abuse of filesystem-backed responses.
 * @see https://codeql.github.com/codeql-query-help/javascript/js-missing-rate-limiting/
 */
export function buildStaticAssetsRateLimiter(options: StaticAssetsRateLimiterOptions = {}): RequestHandler {
	return rateLimit({
		windowMs: options.windowMs ?? 15 * 60 * 1000,
		limit: options.limit ?? 1000,
		standardHeaders: 'draft-8',
		legacyHeaders: false,
		validate: { xForwardedForHeader: false }
	});
}

/**
 * Build a request-path → filesystem entry index from files already on disk.
 * Request handling only looks up keys in this map (no user-controlled path joins).
 */
export function buildStaticAssetIndex(staticDir: string): ReadonlyMap<string, IndexedAsset> {
	const resolvedStaticDir = path.resolve(staticDir);
	const index = new Map<string, IndexedAsset>();

	const walk = (directory: string): void => {
		for (const name of readdirSync(directory)) {
			const absolutePath = path.join(directory, name);
			const stats = statSync(absolutePath);
			if (stats.isDirectory()) {
				walk(absolutePath);
				continue;
			}
			if (!stats.isFile() || name.endsWith('.br')) {
				continue;
			}

			const relativePosix = path.relative(resolvedStaticDir, absolutePath).split(path.sep).join('/');
			const brotliAbsolutePath = `${absolutePath}.br`;
			// floor to seconds: HTTP dates can't express sub-second precision
			const lastModifiedMs = Math.floor(stats.mtimeMs / 1000) * 1000;
			const entry: IndexedAsset = {
				absolutePath,
				etag: `W/"${stats.size}-${lastModifiedMs}"`,
				lastModified: new Date(lastModifiedMs).toUTCString(),
				lastModifiedMs
			};
			if (existsSync(brotliAbsolutePath)) {
				entry.brotliAbsolutePath = brotliAbsolutePath;
			}
			index.set(relativePosix, entry);
		}
	};

	walk(resolvedStaticDir);
	return index;
}

/**
 * Map a URL path to an index key. Rejects traversal / absolute / encoded-dot segments.
 * Returns null when the path must not be served from the static index.
 */
export function staticAssetRequestKey(requestPath: string): string | null {
	if (!requestPath || requestPath === '/') {
		return null;
	}

	let decoded: string;
	try {
		decoded = decodeURIComponent(requestPath);
	} catch {
		return null;
	}

	if (
		decoded.includes('\0') ||
		decoded.includes('\\') ||
		decoded.includes('..') ||
		decoded.includes('%2e') ||
		decoded.includes('%2E')
	) {
		return null;
	}

	const key = decoded.replace(/^\/+/, '');
	if (!key || key.includes('..') || path.isAbsolute(key) || path.win32.isAbsolute(key)) {
		return null;
	}

	return key;
}

/**
 * Serve files from the built `.static` directory with:
 * - Lookup against a startup file index (no user-controlled path joins)
 * - Brotli precompressed sidecars when the client accepts `br`
 * - Rate limiting
 * - `Cache-Control: public, max-age=31536000, immutable` only for fingerprinted assets
 * - `ETag`/`Last-Modified` validators so stale-but-unchanged assets can be
 *   revalidated cheaply with a 304 (mainly the un-fingerprinted 1-day assets)
 */
export function createStaticAssetsMiddleware(
	staticDir: string,
	options: CreateStaticAssetsMiddlewareOptions = {}
): Handler {
	const assetIndex = buildStaticAssetIndex(staticDir);
	const rateLimiter = options.rateLimiter ?? buildStaticAssetsRateLimiter();
	const router = createRouter();

	router.use(rateLimiter);
	router.use(async (req, res, next) => {
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			next();
			return;
		}

		const key = staticAssetRequestKey(req.path);
		if (!key) {
			next();
			return;
		}

		const entry = assetIndex.get(key);
		if (!entry) {
			next();
			return;
		}

		const brotliPath = entry.brotliAbsolutePath;
		const useBrotli = acceptsBrotli(req.get('accept-encoding') ?? undefined) && brotliPath !== undefined;
		const fileToSend = useBrotli ? brotliPath : entry.absolutePath;

		res.status(200);
		res.setHeader('Content-Type', contentTypeFor(entry.absolutePath));
		setCacheControl(res, entry.absolutePath);
		res.setHeader('ETag', entry.etag);
		res.setHeader('Last-Modified', entry.lastModified);
		if (brotliPath !== undefined) {
			// the response varies on Accept-Encoding whenever a br variant exists,
			// even when this particular response is not the encoded one
			res.setHeader('Vary', 'Accept-Encoding');
		}
		if (useBrotli) {
			res.setHeader('Content-Encoding', 'br');
		}

		if (isFreshRequest(req, entry)) {
			res.status(304);
			res.end();
			return;
		}

		if (req.method === 'HEAD') {
			res.end();
			return;
		}

		try {
			await pipeline(createReadStream(fileToSend), res);
		} catch (error) {
			if (!res.headersSent) {
				next(error);
			}
		}
	});

	return router;
}

export const staticAssetCacheControl = {
	fingerprinted: FINGERPRINTED_CACHE_CONTROL,
	unfingerprinted: UNFINGERPRINTED_CACHE_CONTROL
};
