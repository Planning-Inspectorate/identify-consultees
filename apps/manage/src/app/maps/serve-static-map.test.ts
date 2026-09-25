import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { buildConsulteeAreaGeojson, buildProjectSiteGeojson } from './sample-geojson.ts';
import { buildConsulteeStaticMapResponse } from './serve-static-map.ts';
import { clearOsmTileCacheForTests, osmTileCacheSizeForTests } from './static-map.ts';

const tinyPng = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

function requestHostname(input: RequestInfo | URL): string {
	const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
	return new URL(href).hostname;
}

function isGoogleMapsStaticHost(input: RequestInfo | URL): boolean {
	return requestHostname(input) === 'maps.googleapis.com';
}

describe('serve-static-map', () => {
	it('returns 304 without upstream fetches when If-None-Match matches', async () => {
		clearOsmTileCacheForTests();
		const fetchImpl = mock.fn(async () => {
			throw new Error('should not fetch on 304');
		});

		const map = {
			center: [-1.78, 50.62] as const,
			zoom: 10,
			projectGeojson: buildProjectSiteGeojson('EN010024', 'Navitus'),
			consulteeGeojson: buildConsulteeAreaGeojson('Ambulance', [
				{ name: 'A', code: 'A', offsetLng: 0, offsetLat: 0, size: 0.02 }
			]),
			width: 256,
			height: 256
		};

		const first = await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			forceSvg: true,
			fetchImpl: async () => new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png' } })
		});
		assert.equal(first.status, 200);

		const second = await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			forceSvg: true,
			ifNoneMatch: first.etag,
			fetchImpl
		});

		assert.equal(second.status, 304);
		assert.equal(fetchImpl.mock.callCount(), 0);
		assert.ok(first.cacheControl.includes('max-age='));
	});

	it('caches OSM tiles in-process across builds', async () => {
		clearOsmTileCacheForTests();
		let fetchCount = 0;
		const fetchImpl: typeof fetch = async () => {
			fetchCount += 1;
			return new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png' } });
		};

		const map = {
			center: [-1.78, 50.62] as const,
			zoom: 10,
			projectGeojson: buildProjectSiteGeojson('EN010024', 'Navitus'),
			consulteeGeojson: buildConsulteeAreaGeojson('Ambulance', [
				{ name: 'A', code: 'A', offsetLng: 0, offsetLat: 0, size: 0.02 }
			]),
			width: 256,
			height: 256
		};

		await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			forceSvg: true,
			fetchImpl
		});
		const firstFetches = fetchCount;
		assert.ok(firstFetches > 0);
		assert.ok(osmTileCacheSizeForTests() > 0);

		await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			forceSvg: true,
			fetchImpl
		});
		assert.equal(fetchCount, firstFetches);
	});

	it('returns a Google Static Map PNG when a key is configured', async () => {
		clearOsmTileCacheForTests();
		const fetchImpl = async (input: RequestInfo | URL) => {
			assert.equal(requestHostname(input), 'maps.googleapis.com');
			return new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png' } });
		};

		const map = {
			center: [-1.78, 50.62] as const,
			zoom: 10,
			projectGeojson: buildProjectSiteGeojson('EN010024', 'Navitus'),
			consulteeGeojson: buildConsulteeAreaGeojson('Ambulance', [
				{ name: 'A', code: 'A', offsetLng: 0, offsetLat: 0, size: 0.02 }
			])
		};

		const response = await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			googleMapsApiKey: 'test-key',
			fetchImpl
		});

		assert.equal(response.status, 200);
		assert.equal(response.contentType, 'image/png');
		assert.ok(Buffer.isBuffer(response.body));
	});

	it('returns 304 with image/png when a Google Static Map was preferred', async () => {
		clearOsmTileCacheForTests();
		const map = {
			center: [-1.78, 50.62] as const,
			zoom: 10,
			projectGeojson: buildProjectSiteGeojson('EN010024', 'Navitus'),
			consulteeGeojson: buildConsulteeAreaGeojson('Ambulance', [
				{ name: 'A', code: 'A', offsetLng: 0, offsetLat: 0, size: 0.02 }
			]),
			width: 256,
			height: 256
		};

		const first = await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			googleMapsApiKey: 'test-key',
			fetchImpl: async () => new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png' } })
		});
		assert.equal(first.status, 200);
		assert.equal(first.contentType, 'image/png');

		const second = await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			googleMapsApiKey: 'test-key',
			ifNoneMatch: first.etag,
			fetchImpl: async () => {
				throw new Error('should not fetch on 304');
			}
		});

		assert.equal(second.status, 304);
		assert.equal(second.contentType, 'image/png');
	});

	it('falls back to SVG when the Google Static Map request fails', async () => {
		clearOsmTileCacheForTests();
		const map = {
			center: [-1.78, 50.62] as const,
			zoom: 10,
			projectGeojson: buildProjectSiteGeojson('EN010024', 'Navitus'),
			consulteeGeojson: buildConsulteeAreaGeojson('Ambulance', [
				{ name: 'A', code: 'A', offsetLng: 0, offsetLat: 0, size: 0.02 }
			]),
			width: 256,
			height: 256
		};

		const nonOk = await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			googleMapsApiKey: 'test-key',
			fetchImpl: async (input) => {
				if (isGoogleMapsStaticHost(input)) {
					return new Response('nope', { status: 503 });
				}
				return new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png' } });
			}
		});
		assert.equal(nonOk.status, 200);
		assert.match(nonOk.contentType, /image\/svg\+xml/);

		const thrown = await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			googleMapsApiKey: 'test-key',
			fetchImpl: async (input) => {
				if (isGoogleMapsStaticHost(input)) {
					throw new Error('network down');
				}
				return new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png' } });
			}
		});
		assert.equal(thrown.status, 200);
		assert.match(thrown.contentType, /image\/svg\+xml/);
	});
});
