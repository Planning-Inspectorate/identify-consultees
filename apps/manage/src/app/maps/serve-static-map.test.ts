import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
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

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe('serve-static-map', () => {
	it('returns 304 without upstream fetches when If-None-Match matches', async () => {
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

		globalThis.fetch = async () => new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png' } });
		const first = await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			forceSvg: true
		});
		assert.equal(first.status, 200);

		globalThis.fetch = mock.fn(async () => {
			throw new Error('should not fetch on 304');
		});
		const second = await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			forceSvg: true,
			ifNoneMatch: first.etag
		});

		assert.equal(second.status, 304);
		assert.equal((globalThis.fetch as ReturnType<typeof mock.fn>).mock.callCount(), 0);
		assert.ok(first.cacheControl.includes('max-age='));
	});

	it('caches OSM tiles in-process across builds', async () => {
		clearOsmTileCacheForTests();
		let fetchCount = 0;
		globalThis.fetch = async () => {
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
			forceSvg: true
		});
		const firstFetches = fetchCount;
		assert.ok(firstFetches > 0);
		assert.ok(osmTileCacheSizeForTests() > 0);

		await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			forceSvg: true
		});
		assert.equal(fetchCount, firstFetches);
	});

	it('returns a Google Static Map PNG when a key is configured', async () => {
		clearOsmTileCacheForTests();
		globalThis.fetch = async (input) => {
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
			googleMapsApiKey: 'test-key'
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

		globalThis.fetch = async () => new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png' } });
		const first = await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			googleMapsApiKey: 'test-key'
		});
		assert.equal(first.status, 200);
		assert.equal(first.contentType, 'image/png');

		globalThis.fetch = async () => {
			throw new Error('should not fetch on 304');
		};
		const second = await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			googleMapsApiKey: 'test-key',
			ifNoneMatch: first.etag
		});

		assert.equal(second.status, 304);
		assert.equal(second.contentType, 'image/png');
	});

	it('falls back to the OSM-tile raster when the Google Static Map request fails', async () => {
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

		globalThis.fetch = async (input) => {
			if (isGoogleMapsStaticHost(input)) {
				return new Response('nope', { status: 503 });
			}
			return new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png' } });
		};
		const nonOk = await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			googleMapsApiKey: 'test-key'
		});
		assert.equal(nonOk.status, 200);
		assert.equal(nonOk.contentType, 'image/png');

		globalThis.fetch = async (input) => {
			if (isGoogleMapsStaticHost(input)) {
				throw new Error('network down');
			}
			return new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png' } });
		};
		const thrown = await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			googleMapsApiKey: 'test-key'
		});
		assert.equal(thrown.status, 200);
		assert.equal(thrown.contentType, 'image/png');
	});

	it('negotiates avif / webp / png from the Accept header and varies on it', async () => {
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
		globalThis.fetch = async () => new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png' } });

		const avif = await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			accept: 'image/avif,image/webp,image/png,*/*;q=0.8'
		});
		assert.equal(avif.contentType, 'image/avif');
		assert.equal(avif.vary, 'Accept');
		assert.ok(Buffer.isBuffer(avif.body));

		const webp = await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			accept: 'image/webp,image/png,*/*;q=0.8'
		});
		assert.equal(webp.contentType, 'image/webp');

		const png = await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			accept: 'image/png,*/*;q=0.8'
		});
		assert.equal(png.contentType, 'image/png');

		// each variant gets its own ETag so caches do not cross-validate formats
		assert.notEqual(avif.etag, webp.etag);
		assert.notEqual(webp.etag, png.etag);
	});

	it('transcodes a Google Static Map PNG into the negotiated format', async () => {
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

		globalThis.fetch = async () => new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png' } });
		const response = await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			googleMapsApiKey: 'test-key',
			accept: 'image/avif,image/webp,*/*;q=0.8'
		});

		assert.equal(response.status, 200);
		assert.equal(response.contentType, 'image/avif');
		assert.ok(Buffer.isBuffer(response.body));
	});

	it('keeps SVG output on the explicit forceSvg route, without Vary: Accept', async () => {
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

		globalThis.fetch = async () => new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png' } });
		const response = await buildConsulteeStaticMapResponse({
			geometryId: 'geo-1',
			sectionId: 'ambulance-trusts',
			map,
			forceSvg: true,
			accept: 'image/avif,image/webp,*/*;q=0.8'
		});

		assert.equal(response.status, 200);
		assert.match(response.contentType, /image\/svg\+xml/);
		assert.equal(response.vary, undefined);
	});
});
