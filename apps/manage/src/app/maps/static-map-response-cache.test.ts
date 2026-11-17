import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import type { StaticMapResponseBody } from './serve-static-map.ts';
import {
	clearStaticMapResponseCacheForTests,
	renderedStaticMap,
	staticMapResponseCacheSizeForTests
} from './static-map-response-cache.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function ok(etag: string): StaticMapResponseBody {
	return {
		status: 200,
		body: PNG,
		contentType: 'image/png',
		cacheControl: 'private, max-age=3600',
		etag,
		vary: 'Accept',
		basemap: 'osm'
	};
}

afterEach(() => {
	clearStaticMapResponseCacheForTests();
});

describe('renderedStaticMap', () => {
	test('builds on a miss, then serves the remembered response without building', async () => {
		let built = 0;
		const build = async () => {
			built++;
			return ok('"abc"');
		};
		const first = await renderedStaticMap('k', undefined, build);
		const second = await renderedStaticMap('k', undefined, async () => {
			throw new Error('must not build');
		});
		assert.equal(first.status, 200);
		assert.equal(second.status, 200);
		assert.deepEqual(second.body, PNG);
		assert.equal(second.vary, 'Accept');
		assert.equal(second.basemap, 'osm');
		assert.equal(built, 1);
		assert.equal(staticMapResponseCacheSizeForTests(), 1);
	});

	test('answers a matching If-None-Match from the remembered response, without building', async () => {
		await renderedStaticMap('k', undefined, async () => ok('"abc"'));
		const second = await renderedStaticMap('k', '"abc"', async () => {
			throw new Error('must not build');
		});
		assert.equal(second.status, 304);
		assert.equal(second.etag, '"abc"');
		assert.equal(second.vary, 'Accept');
	});

	test('answers a matching If-None-Match from an etag alone, when a 304 was all that was seen', async () => {
		// the first build could only 304: the client already held the image's etag, so the body is
		// unknown - but another request holding it needs no build either
		const first = await renderedStaticMap('k', '"abc"', async () => ({
			status: 304,
			body: Buffer.alloc(0),
			contentType: 'image/avif',
			cacheControl: 'private, max-age=3600',
			etag: '"abc"',
			vary: 'Accept'
		}));
		assert.equal(first.status, 304);

		const second = await renderedStaticMap('k', '"abc"', async () => {
			throw new Error('must not build');
		});
		assert.equal(second.status, 304);
		assert.equal(second.contentType, 'image/avif');
	});

	test('builds again from an etag alone when the client is not holding it', async () => {
		await renderedStaticMap('k', '"abc"', async () => ({
			status: 304,
			body: Buffer.alloc(0),
			contentType: 'image/png',
			cacheControl: 'private, max-age=3600',
			etag: '"abc"'
		}));
		// a different client, without the etag: the remembered one proves nothing - build the image
		const second = await renderedStaticMap('k', '"other"', async () => ok('"abc"'));
		assert.equal(second.status, 200);
		assert.deepEqual(second.body, PNG);
	});

	test("doesn't remember a response that isn't a map - an error is built every time", async () => {
		let built = 0;
		const build = async () => {
			built++;
			return { status: 503, body: 'down', contentType: 'text/plain', cacheControl: 'no-cache', etag: '' };
		};
		await renderedStaticMap('k', undefined, build);
		await renderedStaticMap('k', undefined, build);
		assert.equal(built, 2);
		assert.equal(staticMapResponseCacheSizeForTests(), 0);
	});

	test('remembers a response with no vary or basemap as it is', async () => {
		await renderedStaticMap('k', undefined, async () => ({
			status: 200,
			body: PNG,
			contentType: 'image/png',
			cacheControl: 'private, max-age=3600',
			etag: '"svg"'
		}));
		const hit = await renderedStaticMap('k', undefined, async () => {
			throw new Error('must not build');
		});
		assert.equal(hit.status, 200);
		assert.equal(hit.vary, undefined);
		assert.equal(hit.basemap, undefined);

		const revalidated = await renderedStaticMap('k', '"svg"', async () => {
			throw new Error('must not build');
		});
		assert.equal(revalidated.status, 304);
		assert.equal(revalidated.vary, undefined);
	});

	test('keeps only the etag of a degraded render - missing basemap tiles are not served to everyone', async () => {
		await renderedStaticMap('k', undefined, async () => ({ ...ok('"abc"'), basemapComplete: false }));

		// the client that got it still revalidates on the etag - it holds whatever it got
		const revalidated = await renderedStaticMap('k', '"abc"', async () => {
			throw new Error('must not build');
		});
		assert.equal(revalidated.status, 304);

		// but a request without it builds again rather than being served the gappy image
		let rebuilt = 0;
		const second = await renderedStaticMap('k', undefined, async () => {
			rebuilt++;
			return ok('"abc"');
		});
		assert.equal(rebuilt, 1);
		assert.equal(second.status, 200);
	});

	test('keeps only the etag of an over-budget body - a several-MB SVG revalidates without the megabytes', async () => {
		await renderedStaticMap('k', undefined, async () => ({
			status: 200,
			body: `<!-- ${'x'.repeat(1024 * 1024)} --><svg xmlns="http://www.w3.org/2000/svg"/>`,
			contentType: 'image/svg+xml; charset=utf-8',
			cacheControl: 'private, max-age=3600',
			etag: '"svg"'
		}));

		// the etag still revalidates for a client holding it
		assert.equal(
			(
				await renderedStaticMap('k', '"svg"', async () => {
					throw new Error('must not build');
				})
			).status,
			304
		);

		// but the body is rebuilt for a request that isn't holding it
		let rebuilt = 0;
		await renderedStaticMap('k', undefined, async () => {
			rebuilt++;
			return ok('"abc"');
		});
		assert.equal(rebuilt, 1);
	});

	test('keeps different keys apart', async () => {
		await renderedStaticMap('a', undefined, async () => ok('"one"'));
		await renderedStaticMap('b', undefined, async () => ok('"two"'));
		const hit = await renderedStaticMap('a', undefined, async () => {
			throw new Error('must not build');
		});
		assert.equal(hit.etag, '"one"');
	});
});
