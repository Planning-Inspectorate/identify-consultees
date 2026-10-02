import express from 'express';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import request from 'supertest';
import { createDefraVendorRouter } from './vendor.ts';

describe('defra vendor router', () => {
	test('serves vendor files with the configured cache lifetime and validators', async () => {
		const app = express();
		app.use(createDefraVendorRouter({ maxAge: '1d' }));

		const response = await request(app).get('/vendor/interactive-map/css/index.css');
		assert.equal(response.status, 200);
		assert.match(response.headers['content-type'] || '', /text\/css/);
		assert.match(response.headers['cache-control'] || '', /max-age=86400/);
		// express.static emits validators so stale copies revalidate with 304s
		assert.ok(response.headers.etag);
		assert.ok(response.headers['last-modified']);

		const revalidated = await request(app)
			.get('/vendor/interactive-map/css/index.css')
			.set('If-None-Match', response.headers.etag);
		assert.equal(revalidated.status, 304);
	});

	test('defaults to revalidation (max-age=0) when no lifetime is configured', async () => {
		const app = express();
		app.use(createDefraVendorRouter());

		const response = await request(app).get('/vendor/map-key-plugin/js/index.js');
		assert.equal(response.status, 200);
		assert.match(response.headers['cache-control'] || '', /max-age=0/);
	});
});
