import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	STATIC_MAP_CACHE_CONTROL,
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
			preferGoogle: false
		};

		assert.equal(buildStaticMapFingerprint(input), buildStaticMapFingerprint(input));
		assert.notEqual(
			buildStaticMapFingerprint(input),
			buildStaticMapFingerprint({ ...input, forceSvg: true })
		);
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
});
