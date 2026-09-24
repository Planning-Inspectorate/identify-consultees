/**
 * External origins required by the Defra Interactive Map + OpenFreeMap stack.
 * Static OSM / Google map images are server-proxied and must NOT appear here.
 */
export const OPENFREEMAP_ORIGIN = 'https://tiles.openfreemap.org';

export type CspNonceResponse = {
	locals?: { cspNonce?: string };
};

export type SecurityHeadersOptions = {
	/** When true, enable HSTS and CSP upgrade-insecure-requests. */
	isProduction: boolean;
};

/**
 * Helmet CSP directives for HTML pages.
 *
 * Map-related allowlists:
 * - OpenFreeMap tiles/sprites/glyphs/fonts → connect-src, img-src, font-src
 * - MapLibre workers → worker-src blob:
 * - Defra vendor bundles and static map `<img>` → 'self' only
 */
export function buildContentSecurityPolicyDirectives(options: SecurityHeadersOptions) {
	return {
		defaultSrc: ["'self'"],
		baseUri: ["'self'"],
		objectSrc: ["'none'"],
		frameAncestors: ["'self'"],
		formAction: ["'self'"],
		scriptSrc: ["'self'", (_req: unknown, res: CspNonceResponse) => `'nonce-${res.locals?.cspNonce ?? ''}'`],
		scriptSrcAttr: ["'none'"],
		// GOV.UK Frontend / Defra map chrome still rely on inline style attributes
		styleSrc: ["'self'", "'unsafe-inline'"],
		imgSrc: ["'self'", 'data:', 'blob:', OPENFREEMAP_ORIGIN],
		fontSrc: ["'self'", 'data:', OPENFREEMAP_ORIGIN],
		connectSrc: ["'self'", OPENFREEMAP_ORIGIN],
		workerSrc: ["'self'", 'blob:'],
		childSrc: ["'self'", 'blob:'],
		manifestSrc: ["'self'"],
		upgradeInsecureRequests: options.isProduction ? ([] as string[]) : null
	};
}

/** OWASP-oriented Permissions-Policy: disable powerful features this service does not use. */
export const PERMISSIONS_POLICY =
	'accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), ' +
	'fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), ' +
	'midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), ' +
	'screen-wake-lock=(), sync-xhr=(self), usb=(), web-share=(), xr-spatial-tracking=(), ' +
	'clipboard-read=(), clipboard-write=(), interest-cohort=()';

/** Production HSTS aligned with OWASP HTTP Headers Cheat Sheet (≈2 years + preload). */
export const STRICT_TRANSPORT_SECURITY_PRODUCTION = 'max-age=63072000; includeSubDomains; preload';

export const REFERRER_POLICY = 'no-referrer';
export const X_CONTENT_TYPE_OPTIONS = 'nosniff';
export const X_FRAME_OPTIONS = 'SAMEORIGIN';
export const CROSS_ORIGIN_OPENER_POLICY = 'same-origin';
export const CROSS_ORIGIN_RESOURCE_POLICY = 'same-origin';
