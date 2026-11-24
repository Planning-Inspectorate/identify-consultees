import { createBaseApp } from '@planning-inspectorate/core/app';
import { mockLogger } from '@planning-inspectorate/core/testing';
import express from 'express';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import request from 'supertest';
import {
	buildStaticAssetsRateLimiter,
	createStaticAssetsMiddleware,
	FINGERPRINTED_CACHE_CONTROL,
	preferredEncoding,
	staticAssetRequestKey,
	UNFINGERPRINTED_CACHE_CONTROL
} from './static-assets-middleware.ts';

describe('static-assets-middleware', () => {
	/** @type {string | undefined} */
	let tempDir;

	after(async () => {
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	test('staticAssetRequestKey rejects traversal attempts', () => {
		assert.equal(staticAssetRequestKey('/assets/js/app.js'), 'assets/js/app.js');
		assert.equal(staticAssetRequestKey('/../etc/passwd'), null);
		assert.equal(staticAssetRequestKey('/%2e%2e/etc/passwd'), null);
		assert.equal(staticAssetRequestKey('/assets/../../etc/passwd'), null);
		assert.equal(staticAssetRequestKey('/'), null);
		assert.equal(staticAssetRequestKey('/%E0%A4%A'), null);
		assert.equal(staticAssetRequestKey('/\0file.js'), null);
		assert.equal(staticAssetRequestKey('/C:/Windows/system32'), null);
	});

	test('serves HEAD responses and ignores non-GET methods', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'static-assets-mw-head-'));
		const relative = 'assets/js/app-aabbccdd.js';
		const absolute = path.join(tempDir, ...relative.split('/'));
		await mkdir(path.dirname(absolute), { recursive: true });
		await writeFile(absolute, 'export const value = 1;\n');
		await writeFile(path.join(tempDir, 'unknown.dat'), 'bin');

		const app = express();
		app.use(
			createStaticAssetsMiddleware(tempDir, {
				rateLimiter: buildStaticAssetsRateLimiter({ limit: 100, windowMs: 60_000 })
			})
		);
		app.use((_req, res) => res.status(404).end());

		const head = await request(app).head(`/${relative}`);
		assert.equal(head.status, 200);
		assert.equal(head.headers['cache-control'], FINGERPRINTED_CACHE_CONTROL);

		const post = await request(app).post(`/${relative}`);
		assert.equal(post.status, 404);

		const unknownType = await request(app).get('/unknown.dat');
		assert.equal(unknownType.status, 200);
		assert.match(unknownType.headers['content-type'] || '', /octet-stream/);
	});

	test('serves fingerprinted assets with immutable cache and negotiated br/gzip', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'static-assets-mw-'));
		const fingerprinted = 'assets/js/app-aabbccdd.js';
		const absolute = path.join(tempDir, ...fingerprinted.split('/'));
		await mkdir(path.dirname(absolute), { recursive: true });
		const body = 'export const value = 1;\n';
		await writeFile(absolute, body);
		const brBody = brotliCompressSync(body);
		const gzBody = gzipSync(body);
		await writeFile(`${absolute}.br`, brBody);
		await writeFile(`${absolute}.gz`, gzBody);

		const app = express();
		app.use(
			createStaticAssetsMiddleware(tempDir, {
				rateLimiter: buildStaticAssetsRateLimiter({ limit: 100, windowMs: 60_000 })
			})
		);
		app.use((_req, res) => res.status(404).end());

		// supertest sends its own Accept-Encoding, so identity must be explicit
		const plain = await request(app).get(`/${fingerprinted}`).set('Accept-Encoding', 'identity');
		assert.equal(plain.status, 200);
		assert.equal(plain.headers['cache-control'], FINGERPRINTED_CACHE_CONTROL);
		assert.equal(plain.text, body);
		assert.equal(plain.headers['content-encoding'], undefined);
		assert.equal(Number(plain.headers['content-length']), body.length);

		const br = await request(app).get(`/${fingerprinted}`).set('Accept-Encoding', 'gzip, deflate, br');
		assert.equal(br.status, 200);
		assert.equal(br.headers['content-encoding'], 'br');
		assert.equal(br.headers['cache-control'], FINGERPRINTED_CACHE_CONTROL);
		assert.equal(br.headers['vary'], 'Accept-Encoding');
		assert.equal(Number(br.headers['content-length']), brBody.length);

		const gzip = await request(app).get(`/${fingerprinted}`).set('Accept-Encoding', 'gzip');
		assert.equal(gzip.status, 200);
		assert.equal(gzip.headers['content-encoding'], 'gzip');
		assert.equal(Number(gzip.headers['content-length']), gzBody.length);

		// br is refused - fall back to the gzip variant the client does accept
		const brRefused = await request(app).get(`/${fingerprinted}`).set('Accept-Encoding', 'br;q=0, gzip;q=1');
		assert.equal(brRefused.status, 200);
		assert.equal(brRefused.headers['content-encoding'], 'gzip');

		// identity when every offered variant is refused
		const allRefused = await request(app).get(`/${fingerprinted}`).set('Accept-Encoding', 'br;q=0, gzip;q=0');
		assert.equal(allRefused.status, 200);
		assert.equal(allRefused.headers['content-encoding'], undefined);

		// the unencoded variant must also carry Vary so shared caches (e.g. Front
		// Door) key the object on Accept-Encoding and don't mix the two up
		assert.equal(plain.headers['vary'], 'Accept-Encoding');
	});

	test('preferredEncoding honours q-values, wildcards and availability', () => {
		const both = { br: true, gzip: true };
		assert.equal(preferredEncoding(undefined, both), null);
		assert.equal(preferredEncoding('', both), null);
		assert.equal(preferredEncoding('br', both), 'br');
		assert.equal(preferredEncoding('gzip', both), 'gzip');
		// server prefers the smaller br format on ties
		assert.equal(preferredEncoding('gzip, deflate, br', both), 'br');
		// the client's quality ordering is honoured
		assert.equal(preferredEncoding('gzip;q=1, br;q=0.5', both), 'gzip');
		assert.equal(preferredEncoding('br;q=0, gzip', both), 'gzip');
		assert.equal(preferredEncoding('br;q=0, gzip;q=0', both), null);
		// an explicit listing beats the wildcard: br is refused here despite *;q=1
		assert.equal(preferredEncoding('br;q=0, *;q=1', both), 'gzip');
		assert.equal(preferredEncoding('*;q=0', both), null);
		assert.equal(preferredEncoding('deflate', both), null);
		// empty and malformed entries are ignored, not fatal
		assert.equal(preferredEncoding(', br', both), 'br');
		assert.equal(preferredEncoding('br;q=oops, gzip', both), 'br');
		// a variant the file does not have is never picked
		assert.equal(preferredEncoding('br, gzip', { gzip: true }), 'gzip');
		assert.equal(preferredEncoding('br, gzip', {}), null);
	});

	test('revalidates unchanged assets with 304 via ETag and Last-Modified', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'static-assets-mw-etag-'));
		const relative = 'assets/images/icon.png';
		const absolute = path.join(tempDir, ...relative.split('/'));
		await mkdir(path.dirname(absolute), { recursive: true });
		await writeFile(absolute, Buffer.from([137, 80, 78, 71]));

		const app = express();
		app.use(
			createStaticAssetsMiddleware(tempDir, {
				rateLimiter: buildStaticAssetsRateLimiter({ limit: 100, windowMs: 60_000 })
			})
		);
		app.use((_req, res) => res.status(404).end());

		const first = await request(app).get(`/${relative}`);
		assert.equal(first.status, 200);
		assert.ok(first.headers.etag);
		assert.ok(first.headers['last-modified']);

		const byEtag = await request(app).get(`/${relative}`).set('If-None-Match', first.headers.etag);
		assert.equal(byEtag.status, 304);

		// strong-tag syntax still matches our weak tag (weak comparison)
		const weakCompare = await request(app)
			.get(`/${relative}`)
			.set('If-None-Match', first.headers.etag.replace(/^W\//, ''));
		assert.equal(weakCompare.status, 304);

		const wildcard = await request(app).get(`/${relative}`).set('If-None-Match', '*');
		assert.equal(wildcard.status, 304);

		const byDate = await request(app).get(`/${relative}`).set('If-Modified-Since', first.headers['last-modified']);
		assert.equal(byDate.status, 304);

		const staleEtag = await request(app).get(`/${relative}`).set('If-None-Match', '"0000-0"');
		assert.equal(staleEtag.status, 200);
	});

	test('serves unfingerprinted assets without immutable', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'static-assets-mw-plain-'));
		const relative = 'assets/images/icon.png';
		const absolute = path.join(tempDir, ...relative.split('/'));
		await mkdir(path.dirname(absolute), { recursive: true });
		await writeFile(absolute, Buffer.from([137, 80, 78, 71]));

		const app = express();
		app.use(
			createStaticAssetsMiddleware(tempDir, {
				rateLimiter: buildStaticAssetsRateLimiter({ limit: 100, windowMs: 60_000 })
			})
		);
		app.use((_req, res) => res.status(404).end());

		const response = await request(app).get(`/${relative}`);
		assert.equal(response.status, 200);
		assert.equal(response.headers['cache-control'], UNFINGERPRINTED_CACHE_CONTROL);
	});

	test('does not serve path traversal requests', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'static-assets-mw-traverse-'));
		await writeFile(path.join(tempDir, 'safe-aabbccdd.js'), 'ok');

		const app = express();
		app.use(
			createStaticAssetsMiddleware(tempDir, {
				rateLimiter: buildStaticAssetsRateLimiter({ limit: 100, windowMs: 60_000 })
			})
		);
		app.use((_req, res) => res.status(404).end());

		const response = await request(app).get('/../safe-aabbccdd.js');
		assert.equal(response.status, 404);
	});

	test('only indexes asset requests consume the rate limiter', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'static-assets-mw-limit-'));
		const relative = 'assets/js/app-aabbccdd.js';
		const absolute = path.join(tempDir, ...relative.split('/'));
		await mkdir(path.dirname(absolute), { recursive: true });
		await writeFile(absolute, 'export const value = 1;\n');

		const app = express();
		let limited = 0;
		app.use(
			createStaticAssetsMiddleware(tempDir, {
				rateLimiter: (_req, _res, next) => {
					limited++;
					next();
				}
			})
		);
		app.use((_req, res) => res.status(200).end('page'));

		// page requests, asset misses and non-GET methods stay outside the bucket
		await request(app).get('/');
		await request(app).get('/consultees/some-page');
		await request(app).get('/assets/js/missing-aabbccdd.js');
		await request(app).post(`/${relative}`);
		assert.equal(limited, 0);

		await request(app).get(`/${relative}`);
		assert.equal(limited, 1);
	});

	test('forwards stream errors when the asset disappears after indexing', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'static-assets-mw-gone-'));
		const relative = 'assets/js/app-aabbccdd.js';
		const absolute = path.join(tempDir, ...relative.split('/'));
		await mkdir(path.dirname(absolute), { recursive: true });
		await writeFile(absolute, 'export const value = 1;\n');

		const app = express();
		app.use(
			createStaticAssetsMiddleware(tempDir, {
				rateLimiter: buildStaticAssetsRateLimiter({ limit: 100, windowMs: 60_000 })
			})
		);
		app.use((error, _req, res, _next) => {
			res.status(500).send(String(error?.code || error?.message || error));
		});
		app.use((_req, res) => res.status(404).end());

		await rm(absolute);
		await assert.rejects(
			() => request(app).get(`/${relative}`),
			(error) => {
				assert.match(String(error?.code || error?.message || error), /ECONNRESET|socket hang up|ENOENT/);
				return true;
			}
		);
	});

	test('integrates ahead of createBaseApp empty static mount', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'static-assets-mw-core-'));
		const noop = path.join(tempDir, '.core-static-noop');
		await mkdir(noop, { recursive: true });
		const relative = 'style-11223344.css';
		await writeFile(path.join(tempDir, relative), 'body{}');

		const service = {
			logger: mockLogger(),
			staticDir: noop,
			cacheControl: { maxAge: '1d' },
			redisClient: null,
			sessionSecret: 'test-session-secret-at-least-32-chars',
			secureSession: false,
			otherSessionOptions: {}
		};

		const app = createBaseApp({
			service,
			router: express.Router(),
			middlewares: [
				createStaticAssetsMiddleware(tempDir, {
					rateLimiter: buildStaticAssetsRateLimiter({ limit: 100, windowMs: 60_000 })
				})
			]
		});

		const response = await request(app).get(`/${relative}`);
		assert.equal(response.status, 200);
		assert.equal(response.headers['cache-control'], FINGERPRINTED_CACHE_CONTROL);
		assert.equal(response.text, 'body{}');
	});
});
