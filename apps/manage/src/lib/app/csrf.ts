import type { RequestHandler } from 'express';
import lusca from 'lusca';

export type LuscaCsrf = {
	csrf: typeof lusca.csrf;
};

export type RouteMatch = string | RegExp;

/**
 *
 * @param bypassList
 * @param multiPartFormRoutes
 * @param lib for testing
 */
export function buildCsrfMiddleware(
	bypassList: string[],
	multiPartFormRoutes: RouteMatch[],
	lib: LuscaCsrf = lusca
): RequestHandler {
	const csrfMiddleware = lib.csrf({
		blocklist: bypassList
	});

	if (multiPartFormRoutes.length === 0) {
		// if no multipart form exceptions, add csrf to all routes
		return csrfMiddleware;
	} else {
		// CSRF protection middleware, with an exception for file upload endpoints which uses Multer and multipart/form-data
		// see https://github.com/krakenjs/lusca/issues/70
		return (req, res, next) => {
			if (
				req.method === 'POST' &&
				req.is('multipart/form-data') &&
				multiPartFormRoutes.some((formRoute) => routeMatch(req.path, formRoute))
			) {
				// multer multipart/form-data needs to be handled before Lusca CSRF check
				next();
			} else {
				csrfMiddleware(req, res, next);
			}
		};
	}
}

function routeMatch(path: string, toMatch: RouteMatch): boolean {
	if (typeof toMatch === 'string') {
		return path === toMatch;
	}
	return toMatch.test(path);
}
