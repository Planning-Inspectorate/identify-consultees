import type { Handler, Request, RequestHandler, Response } from 'express';
import { Router as createRouter } from 'express';
import rateLimit from 'express-rate-limit';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { clientAddressKey } from './client-address.ts';
import { isFingerprintedAssetPath } from './fingerprint-assets.ts';

export const FINGERPRINTED_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const UNFINGERPRINTED_CACHE_CONTROL = 'public, max-age=86400';

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

type CompressedVariant = {
	/** Absolute path of the sidecar discovered at startup. */
	absolutePath: string;
	/** Compressed size, for Content-Length. */
	size: number;
};

type IndexedAsset = {
	/** Absolute path discovered at startup (never derived from the request). */
	absolutePath: string;
	/** Plain size, for Content-Length on the identity variant. */
	size: number;
	/** Optional Brotli sidecar discovered at startup. */
	brotli?: CompressedVariant;
	/** Optional gzip sidecar discovered at startup. */
	gzip?: CompressedVariant;
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

/**
 * Content-negotiate an Accept-Encoding header against the variants a file
 * actually has. Parses q-values and the `*` wildcard per RFC 9110 — an
 * explicitly listed coding beats the wildcard, so `br;q=0, *;q=1` refuses br.
 * br wins ties because it is the smaller wire format; the client's quality
 * ordering is honoured otherwise.
 */
export function preferredEncoding(
	acceptEncodingHeader: string | undefined,
	available: { br?: boolean; gzip?: boolean }
): 'br' | 'gzip' | null {
	if (!acceptEncodingHeader) {
		return null;
	}
	const qualities = new Map<string, number>();
	for (const part of acceptEncodingHeader.split(',')) {
		const [token, ...parameters] = part.split(';');
		const name = token.trim().toLowerCase();
		if (!name) {
			continue;
		}
		let quality = 1;
		for (const parameter of parameters) {
			const [key, value] = parameter.split('=');
			if (key?.trim().toLowerCase() === 'q') {
				const parsed = Number(value);
				if (!Number.isNaN(parsed)) {
					quality = parsed;
				}
			}
		}
		qualities.set(name, quality);
	}
	const quality = (name: string): number => qualities.get(name) ?? qualities.get('*') ?? 0;
	const brQuality = available.br ? quality('br') : 0;
	const gzipQuality = available.gzip ? quality('gzip') : 0;
	if (brQuality <= 0 && gzipQuality <= 0) {
		return null;
	}
	return brQuality >= gzipQuality ? 'br' : 'gzip';
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
		// each client its own limit, not each Front Door edge's (see clientAddressKey)
		keyGenerator: clientAddressKey,
		validate: { xForwardedForHeader: false }
	});
}

/**
 * Build a request-path → filesystem entry index from files already on disk.
 * Request handling only looks up keys in this map (no user-controlled path joins).
 */
function buildStaticAssetIndex(staticDir: string): ReadonlyMap<string, IndexedAsset> {
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
			if (!stats.isFile() || name.endsWith('.br') || name.endsWith('.gz')) {
				continue;
			}

			const relativePosix = path.relative(resolvedStaticDir, absolutePath).split(path.sep).join('/');
			// floor to seconds: HTTP dates can't express sub-second precision
			const lastModifiedMs = Math.floor(stats.mtimeMs / 1000) * 1000;
			const entry: IndexedAsset = {
				absolutePath,
				size: stats.size,
				etag: `W/"${stats.size}-${lastModifiedMs}"`,
				lastModified: new Date(lastModifiedMs).toUTCString(),
				lastModifiedMs
			};
			const sidecar = (extension: string): CompressedVariant | undefined => {
				const sidecarPath = `${absolutePath}.${extension}`;
				if (!existsSync(sidecarPath)) {
					return undefined;
				}
				return { absolutePath: sidecarPath, size: statSync(sidecarPath).size };
			};
			const brotli = sidecar('br');
			if (brotli) {
				entry.brotli = brotli;
			}
			const gzip = sidecar('gz');
			if (gzip) {
				entry.gzip = gzip;
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
 * - Precompressed `.br`/`.gz` sidecars negotiated from Accept-Encoding
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

	// this middleware runs for every app request, but the limiter exists for the
	// filesystem-backed asset responses - only index hits consume its bucket, so
	// page traffic (and primed-cache bursts) cannot starve real asset requests
	router.use((req, res, next) => {
		const key = req.method === 'GET' || req.method === 'HEAD' ? staticAssetRequestKey(req.path) : null;
		if (key !== null && assetIndex.has(key)) {
			rateLimiter(req, res, next);
			return;
		}
		next();
	});
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

		const encoding = preferredEncoding(req.get('accept-encoding') ?? undefined, {
			br: entry.brotli !== undefined,
			gzip: entry.gzip !== undefined
		});
		const variant = encoding === 'br' ? entry.brotli : encoding === 'gzip' ? entry.gzip : undefined;
		const fileToSend = variant?.absolutePath ?? entry.absolutePath;

		res.status(200);
		res.setHeader('Content-Type', contentTypeFor(entry.absolutePath));
		res.setHeader('Content-Length', variant?.size ?? entry.size);
		setCacheControl(res, entry.absolutePath);
		res.setHeader('ETag', entry.etag);
		res.setHeader('Last-Modified', entry.lastModified);
		if (entry.brotli !== undefined || entry.gzip !== undefined) {
			// the response varies on Accept-Encoding whenever an encoded variant
			// exists, even when this particular response is not the encoded one
			res.setHeader('Vary', 'Accept-Encoding');
		}
		if (encoding) {
			res.setHeader('Content-Encoding', encoding);
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
