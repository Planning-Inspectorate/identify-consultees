import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	OPENFREEMAP_ORIGIN,
	PERMISSIONS_POLICY,
	STRICT_TRANSPORT_SECURITY_PRODUCTION,
	buildContentSecurityPolicyDirectives
} from './owasp-headers.ts';

describe('OWASP / map-aware CSP directives', () => {
	test('allows OpenFreeMap for tiles, fonts and images', () => {
		const directives = buildContentSecurityPolicyDirectives({ isProduction: true });

		assert.ok(directives.connectSrc.includes(OPENFREEMAP_ORIGIN));
		assert.ok(directives.imgSrc.includes(OPENFREEMAP_ORIGIN));
		assert.ok(directives.fontSrc.includes(OPENFREEMAP_ORIGIN));
		assert.ok(directives.imgSrc.includes('blob:'));
		assert.ok(directives.workerSrc.includes('blob:'));
		assert.ok(directives.childSrc.includes('blob:'));
	});

	test('does not allow third-party static map hosts in client CSP', () => {
		const directives = buildContentSecurityPolicyDirectives({ isProduction: true });
		const joined = [
			...directives.connectSrc,
			...directives.imgSrc,
			...directives.fontSrc,
			...directives.scriptSrc.filter((value): value is string => typeof value === 'string')
		].join(' ');

		assert.equal(joined.includes('tile.openstreetmap.org'), false);
		assert.equal(joined.includes('maps.googleapis.com'), false);
	});

	test('enables upgrade-insecure-requests only in production', () => {
		assert.deepEqual(buildContentSecurityPolicyDirectives({ isProduction: true }).upgradeInsecureRequests, []);
		assert.equal(buildContentSecurityPolicyDirectives({ isProduction: false }).upgradeInsecureRequests, null);
	});

	test('Permissions-Policy disables high-risk browser features', () => {
		assert.match(PERMISSIONS_POLICY, /camera=\(\)/);
		assert.match(PERMISSIONS_POLICY, /microphone=\(\)/);
		assert.match(PERMISSIONS_POLICY, /geolocation=\(\)/);
		assert.match(PERMISSIONS_POLICY, /payment=\(\)/);
		assert.match(PERMISSIONS_POLICY, /interest-cohort=\(\)/);
	});

	test('production HSTS matches OWASP long-lived recommendation', () => {
		assert.equal(STRICT_TRANSPORT_SECURITY_PRODUCTION, 'max-age=63072000; includeSubDomains; preload');
	});
});
