import { createBaseApp } from '@planning-inspectorate/core/app';
import { mockLogger } from '@planning-inspectorate/core/testing';
import express from 'express';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { brotliCompressSync } from 'node:zlib';
import request from 'supertest';
import { createStaticAssetsMiddleware, staticAssetCacheControl } from './static-assets-middleware.ts';

describe('static-assets-middleware', () => {
	/** @type {string | undefined} */
	let tempDir;

	after(async () => {
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	test('serves fingerprinted assets with immutable cache and optional Brotli', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'static-assets-mw-'));
		const fingerprinted = 'assets/js/app-aabbccdd.js';
		const absolute = path.join(tempDir, ...fingerprinted.split('/'));
		await mkdir(path.dirname(absolute), { recursive: true });
		const body = 'export const value = 1;\n';
		await writeFile(absolute, body);
		await writeFile(`${absolute}.br`, brotliCompressSync(body));

		const app = express();
		app.use(createStaticAssetsMiddleware(tempDir));
		app.use((_req, res) => res.status(404).end());

		const plain = await request(app).get(`/${fingerprinted}`);
		assert.equal(plain.status, 200);
		assert.equal(plain.headers['cache-control'], staticAssetCacheControl.fingerprinted);
		assert.equal(plain.text, body);
		assert.equal(plain.headers['content-encoding'], undefined);

		const br = await request(app).get(`/${fingerprinted}`).set('Accept-Encoding', 'gzip, deflate, br');
		assert.equal(br.status, 200);
		assert.equal(br.headers['content-encoding'], 'br');
		assert.equal(br.headers['cache-control'], staticAssetCacheControl.fingerprinted);
		assert.equal(br.headers['vary'], 'Accept-Encoding');
	});

	test('serves unfingerprinted assets without immutable', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'static-assets-mw-plain-'));
		const relative = 'assets/images/icon.png';
		const absolute = path.join(tempDir, ...relative.split('/'));
		await mkdir(path.dirname(absolute), { recursive: true });
		await writeFile(absolute, Buffer.from([137, 80, 78, 71]));

		const app = express();
		app.use(createStaticAssetsMiddleware(tempDir));
		app.use((_req, res) => res.status(404).end());

		const response = await request(app).get(`/${relative}`);
		assert.equal(response.status, 200);
		assert.equal(response.headers['cache-control'], staticAssetCacheControl.unfingerprinted);
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
			middlewares: [createStaticAssetsMiddleware(tempDir)]
		});

		const response = await request(app).get(`/${relative}`);
		assert.equal(response.status, 200);
		assert.equal(response.headers['cache-control'], staticAssetCacheControl.fingerprinted);
		assert.equal(response.text, 'body{}');
	});
});
