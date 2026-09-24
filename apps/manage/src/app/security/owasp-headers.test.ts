import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	OPENFREEMAP_ORIGIN,
	PERMISSIONS_POLICY,
	STRICT_TRANSPORT_SECURITY_PRODUCTION,
	buildContentSecurityPolicyDirectives
} from './owasp-headers.ts';

function httpsHostnamesFromCspSources(sources: Iterable<unknown>): string[] {
	const hostnames: string[] = [];
	for (const source of sources) {
		if (typeof source !== 'string' || !/^https?:\/\//i.test(source)) {
			continue;
		}
		try {
			hostnames.push(new URL(source).hostname);
		} catch {
			// Ignore non-URL CSP tokens such as 'self'
		}
	}
	return hostnames;
}

describe('OWASP / map-aware CSP directives', () => {
	test('allows OpenFreeMap for tiles, fonts and images', () => {
		const directives = buildContentSecurityPolicyDirectives({ isProduction: true });

		assert.ok(directives.connectSrc.includes(OPENFREEMAP_ORIGIN));
		assert.ok(directives.imgSrc.includes(OPENFREEMAP_ORIGIN));
		assert.ok(directives.fontSrc.includes(OPENFREEMAP_ORIGIN));
		assert.ok(directives.imgSrc.includes('blob:'));
		assert.ok(directives.workerSrc.includes('blob:'));
		assert.ok(directives.childSrc.includes('blob:'));
		assert.equal(new URL(OPENFREEMAP_ORIGIN).hostname, 'tiles.openfreemap.org');
	});

	test('does not allow third-party static map hosts in client CSP', () => {
		const directives = buildContentSecurityPolicyDirectives({ isProduction: true });
		const hostnames = httpsHostnamesFromCspSources([
			...directives.connectSrc,
			...directives.imgSrc,
			...directives.fontSrc,
			...directives.scriptSrc
		]);

		assert.equal(
			hostnames.some((hostname) => hostname === 'tile.openstreetmap.org'),
			false
		);
		assert.equal(
			hostnames.some((hostname) => hostname === 'maps.googleapis.com'),
			false
		);
		assert.ok(hostnames.some((hostname) => hostname === 'tiles.openfreemap.org'));
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
