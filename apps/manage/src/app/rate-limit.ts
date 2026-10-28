import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';

export type RateLimiterOptions = {
	windowMs?: number;
	limit?: number;
};

// every limiter shares these choices: draft-8 standard headers, no legacy
// X-RateLimit-* headers, and no X-Forwarded-For validation (tests and local
// setups often omit the header). Limits apply per client IP - Express trust
// proxy is one hop for Front Door.
function buildLimiter(defaults: Required<RateLimiterOptions>, options: RateLimiterOptions): RequestHandler {
	return rateLimit({
		windowMs: options.windowMs ?? defaults.windowMs,
		limit: options.limit ?? defaults.limit,
		standardHeaders: 'draft-8',
		legacyHeaders: false,
		validate: { xForwardedForHeader: false }
	});
}

/**
 * Limit auth endpoints to reduce abuse of MSAL sign-in and redirect handlers.
 * @see https://codeql.github.com/codeql-query-help/javascript/js-missing-rate-limiting/
 */
export function buildAuthRateLimiter(options: RateLimiterOptions = {}): RequestHandler {
	return buildLimiter({ windowMs: 15 * 60 * 1000, limit: 100 }, options);
}

/**
 * Limit report downloads: each builds a zip with an Excel workbook and a PDF
 * map per category (sharp and PDFKit - seconds of CPU per request). The route
 * sits behind sign-in and the WAF's own rate limit, so this bounds what one
 * busy session can do to the single Node process rather than anonymous
 * traffic - a report is downloaded a handful of times in normal use. If real
 * (not abusive) load ever trips it, that is the signal to move generation off
 * the request path rather than raise the limit.
 */
export function buildReportDownloadRateLimiter(options: RateLimiterOptions = {}): RequestHandler {
	return buildLimiter({ windowMs: 15 * 60 * 1000, limit: 20 }, options);
}

/**
 * Limit server-rendered static maps, which fetch upstream tiles per request.
 * The report pages embed one <img> per category and browsers revalidate
 * (304s still count), so the limit has to cover several pages' worth of
 * images, not single requests.
 */
export function buildStaticMapRateLimiter(options: RateLimiterOptions = {}): RequestHandler {
	return buildLimiter({ windowMs: 15 * 60 * 1000, limit: 300 }, options);
}
