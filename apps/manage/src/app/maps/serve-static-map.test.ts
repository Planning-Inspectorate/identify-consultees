import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { buildConsulteeAreaGeojson, buildProjectSiteGeojson } from './sample-geojson.ts';
import { buildConsulteeStaticMapResponse } from './serve-static-map.ts';
import { clearOsmTileCacheForTests, osmTileCacheSizeForTests } from './static-map.ts';

const tinyPng = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

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
});
