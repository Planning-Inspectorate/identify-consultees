import type { Handler } from 'express';
import {
	CROSS_ORIGIN_OPENER_POLICY,
	CROSS_ORIGIN_RESOURCE_POLICY,
	PERMISSIONS_POLICY,
	REFERRER_POLICY,
	STRICT_TRANSPORT_SECURITY_PRODUCTION,
	X_CONTENT_TYPE_OPTIONS,
	X_FRAME_OPTIONS,
	type SecurityHeadersOptions
} from './owasp-headers.ts';

/**
 * Reinforce OWASP-recommended HTML response headers after Helmet (from core).
 * Permissions-Policy is not set by Helmet 8 and must be added here.
 * HSTS is production-only so local HTTP development is not sticky-HSTS'd.
 */
export function buildOwaspSecurityHeadersMiddleware(options: SecurityHeadersOptions): Handler {
	return (_req, res, next) => {
		res.setHeader('X-Content-Type-Options', X_CONTENT_TYPE_OPTIONS);
		res.setHeader('X-Frame-Options', X_FRAME_OPTIONS);
		res.setHeader('Referrer-Policy', REFERRER_POLICY);
		res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
		res.setHeader('Cross-Origin-Opener-Policy', CROSS_ORIGIN_OPENER_POLICY);
		res.setHeader('Cross-Origin-Resource-Policy', CROSS_ORIGIN_RESOURCE_POLICY);
		res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
		res.setHeader('X-DNS-Prefetch-Control', 'off');

		if (options.isProduction) {
			res.setHeader('Strict-Transport-Security', STRICT_TRANSPORT_SECURITY_PRODUCTION);
		} else {
			res.removeHeader('Strict-Transport-Security');
		}

		next();
	};
}
