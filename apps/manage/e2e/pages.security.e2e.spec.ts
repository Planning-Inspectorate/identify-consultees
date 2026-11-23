import { expect, test } from '@playwright/test';
import { SAMPLE_CASE_REFERENCE } from './fixtures.ts';

/**
 * The OWASP headers are unit-tested in security-headers.test.ts, but that only proves the
 * middleware sets them - not that they survive onto real responses. A middleware ordering
 * change or an error path that bypasses it would strip them silently; these are the
 * end-to-end assertions on the served headers, including the CSP nonce matching the ones
 * the page's scripts carry (a mismatch there stops every script running).
 */

const ALWAYS_ON_HEADERS: Record<string, string> = {
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'SAMEORIGIN',
	'referrer-policy': 'no-referrer',
	'x-permitted-cross-domain-policies': 'none',
	'x-dns-prefetch-control': 'off',
	'cross-origin-opener-policy': 'same-origin',
	'cross-origin-resource-policy': 'same-origin',
	'cross-origin-embedder-policy': 'credentialless'
};

function expectSecurityHeaders(headers: Record<string, string>, path: string) {
	const wrong = Object.entries(ALWAYS_ON_HEADERS).filter(([name, value]) => headers[name] !== value);
	expect(wrong, `${path}: wrong or missing headers`).toEqual([]);
	expect(headers['permissions-policy'], `${path}: Permissions-Policy`).toContain('camera=()');
	// HSTS is production-only - the e2e server serves http, where sending it would
	// sticky-lock the browser onto an origin that cannot do TLS
	expect(headers['strict-transport-security'], `${path}: HSTS must stay off non-production`).toBeUndefined();
}

test('rendered pages carry the security headers and a CSP nonce their scripts share', async ({ request }) => {
	const response = await request.get(`/?q=${SAMPLE_CASE_REFERENCE}`);
	expect(response.ok()).toBeTruthy();
	const headers = response.headers();
	expectSecurityHeaders(headers, '/');

	const csp = headers['content-security-policy'] ?? '';
	for (const directive of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'self'"]) {
		expect(csp, `Content-Security-Policy missing ${directive}`).toContain(directive);
	}
	const nonces = [...(await response.text()).matchAll(/nonce="?([^\s">]+)"?/g)].map((match) => match[1]);
	expect(nonces.length, 'expected at least one nonced script').toBeGreaterThan(0);
	for (const nonce of nonces) {
		expect(csp, "CSP script-src does not allow the page's nonce").toContain(`'nonce-${nonce}'`);
	}
});

test('error responses carry the security headers too', async ({ request }) => {
	const response = await request.get('/this-page-does-not-exist');
	expect(response.status()).toBe(404);
	expectSecurityHeaders(response.headers(), '/this-page-does-not-exist');
});
