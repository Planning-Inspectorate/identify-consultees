import type { Handler, Response } from 'express';
import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
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

function contentTypeFor(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

function acceptsBrotli(acceptEncodingHeader: string | undefined): boolean {
	if (!acceptEncodingHeader) {
		return false;
	}
	return acceptEncodingHeader.split(',').some((part) => part.trim().toLowerCase().startsWith('br'));
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

function setCacheControl(res: Response, absolutePath: string): void {
	res.setHeader(
		'Cache-Control',
		isFingerprintedAssetPath(absolutePath) ? FINGERPRINTED_CACHE_CONTROL : UNFINGERPRINTED_CACHE_CONTROL
	);
}

/**
 * Serve files from the built `.static` directory with:
 * - Brotli precompressed sidecars when the client accepts `br`
 * - `Cache-Control: public, max-age=31536000, immutable` only for fingerprinted assets
 */
export function createStaticAssetsMiddleware(staticDir: string): Handler {
	const resolvedStaticDir = path.resolve(staticDir);

	return async (req, res, next) => {
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			next();
			return;
		}

		const requestPath = req.path;
		if (!requestPath || requestPath === '/' || requestPath.includes('\0')) {
			next();
			return;
		}

		const decodedPath = decodeURIComponent(requestPath);
		const absolutePath = path.resolve(resolvedStaticDir, `.${decodedPath}`);
		if (absolutePath !== resolvedStaticDir && !absolutePath.startsWith(resolvedStaticDir + path.sep)) {
			next();
			return;
		}

		try {
			const fileStats = await stat(absolutePath);
			if (!fileStats.isFile()) {
				next();
				return;
			}
		} catch {
			next();
			return;
		}

		const useBrotli = acceptsBrotli(req.get('accept-encoding') ?? undefined);
		const brPath = `${absolutePath}.br`;
		const serveBrotli = useBrotli && (await fileExists(brPath));
		const fileToSend = serveBrotli ? brPath : absolutePath;

		res.status(200);
		res.setHeader('Content-Type', contentTypeFor(absolutePath));
		setCacheControl(res, absolutePath);
		if (serveBrotli) {
			res.setHeader('Content-Encoding', 'br');
			res.setHeader('Vary', 'Accept-Encoding');
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
	};
}

export const staticAssetCacheControl = {
	fingerprinted: FINGERPRINTED_CACHE_CONTROL,
	unfingerprinted: UNFINGERPRINTED_CACHE_CONTROL
};
