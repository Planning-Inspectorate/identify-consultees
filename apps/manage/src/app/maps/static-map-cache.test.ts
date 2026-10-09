import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	STATIC_MAP_CACHE_CONTROL,
	STATIC_MAP_CACHE_CONTROL_PRIVATE,
	buildStaticMapFingerprint,
	etagFromFingerprint,
	etagMatches
} from './static-map-cache.ts';

describe('static-map-cache', () => {
	it('builds a stable fingerprint for the same inputs', () => {
		const input = {
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			center: [-1.78, 50.62] as const,
			zoom: 11,
			projectGeojson: { type: 'FeatureCollection', features: [] },
			consulteeGeojson: { type: 'FeatureCollection', features: [] },
			width: 960,
			height: 516,
			forceSvg: false,
			preferGoogle: false,
			format: 'png'
		};

		assert.equal(buildStaticMapFingerprint(input), buildStaticMapFingerprint(input));
		assert.notEqual(buildStaticMapFingerprint(input), buildStaticMapFingerprint({ ...input, forceSvg: true }));
		// each negotiated variant needs its own ETag — a shared one would let a
		// webp cache entry validate an avif request body
		assert.notEqual(buildStaticMapFingerprint(input), buildStaticMapFingerprint({ ...input, format: 'avif' }));
	});

	it('matches If-None-Match lists against the response ETag', () => {
		const etag = etagFromFingerprint('abcdef0123456789abcdef0123456789ffff');
		assert.equal(etagMatches(etag, etag), true);
		assert.equal(etagMatches(`W/${etag}, "other"`, etag), true);
		assert.equal(etagMatches('"nope"', etag), false);
		assert.equal(etagMatches('*', etag), true);
	});

	it('uses a long-lived Cache-Control directive', () => {
		assert.match(STATIC_MAP_CACHE_CONTROL, /max-age=3600/);
		assert.match(STATIC_MAP_CACHE_CONTROL, /stale-while-revalidate/);
	});

	it('keeps case-derived images out of shared caches', () => {
		assert.match(STATIC_MAP_CACHE_CONTROL_PRIVATE, /^private/);
		assert.match(STATIC_MAP_CACHE_CONTROL_PRIVATE, /max-age=3600/);
		assert.doesNotMatch(STATIC_MAP_CACHE_CONTROL_PRIVATE, /stale-while-revalidate/);
	});
});
