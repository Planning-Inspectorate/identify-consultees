import { ManageService } from '#service';
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import request from 'supertest';
import { buildAuthRateLimiter } from './router.ts';
import { buildManageTestConfig, createManageTestApp, createManageTestService } from './testing/create-test-app.ts';

describe('manage router wiring', () => {
	const authDisabledService = createManageTestService(true);
	const authDisabledApp = createManageTestApp(authDisabledService);

	after(async () => {
		await authDisabledService.db.$disconnect().catch(() => undefined);
	});

	test('GET / renders the identify consultees home page', async () => {
		const response = await request(authDisabledApp).get('/');
		assert.equal(response.status, 200);
		assert.match(response.text, /Identify consultees for an infrastructure project/);
		assert.match(response.text, /Choose a ruleset/);
		assert.match(response.text, /Gwynt Glas Offshore Wind Farm/);
	});

	test('GET /signed-out renders the signed out page', async () => {
		const response = await request(authDisabledApp).get('/signed-out');
		assert.equal(response.status, 200);
		assert.match(response.text, /You have signed out/);
		assert.match(response.text, /Sign in again/);
	});

	test('GET /auth/signout redirects to /signed-out when auth is disabled', async () => {
		const response = await request(authDisabledApp).get('/auth/signout');
		assert.equal(response.status, 302);
		assert.equal(response.headers.location, '/signed-out');
	});

	test('GET /?pageSize=50 returns fifty geometry rows', async () => {
		const response = await request(authDisabledApp).get('/?pageSize=50');
		assert.equal(response.status, 200);
		assert.match(response.text, /Showing 1 to 50 of 100 results/);
		assert.match(response.text, />50</);
	});

	test('GET /consultees/:id renders consultees results page', async () => {
		const response = await request(authDisabledApp).get('/consultees/geo-1');
		assert.equal(response.status, 200);
		assert.match(response.text, /Consultees identified for/);
		assert.match(response.text, /Ambulance Trusts/);
		assert.match(response.text, /Police Force Areas/);
	});

	test('GET /consultees redirects to results when geometryId is provided', async () => {
		const response = await request(authDisabledApp).get(
			'/consultees?geometryId=geo-1&ruleset=post-30-apr-2024-england-wales'
		);
		assert.equal(response.status, 302);
		assert.equal(response.headers.location, '/consultees/geo-1?ruleset=post-30-apr-2024-england-wales');
	});

	test('GET /consultees redirects to results without ruleset when only geometryId is set', async () => {
		const response = await request(authDisabledApp).get('/consultees?geometryId=geo-1');
		assert.equal(response.status, 302);
		assert.equal(response.headers.location, '/consultees/geo-1');
	});

	test('GET /auth/signout forwards session destroy errors', async () => {
		const express = (await import('express')).default;
		const service = createManageTestService(true);
		service.logger = (await import('@planning-inspectorate/core/testing')).mockLogger();
		const { buildRouter } = await import('./router.ts');
		const app = express();
		app.use((req, _res, next) => {
			req.session = {
				destroy(callback) {
					callback(new Error('destroy failed'));
				}
			};
			next();
		});
		app.use(buildRouter(service));
		app.use((error, _req, res, _next) => {
			res.status(500).send(String(error.message || error));
		});

		try {
			const response = await request(app).get('/auth/signout');
			assert.equal(response.status, 500);
			assert.match(response.text, /destroy failed/);
		} finally {
			await service.db.$disconnect().catch(() => undefined);
		}
	});

	test('GET /map-layers-demo renders the layer toggles prototype', async () => {
		const response = await request(authDisabledApp).get('/map-layers-demo');
		assert.equal(response.status, 200);
		assert.match(response.text, /Map layers demo/);
		assert.match(response.text, /Railway lines/);
		assert.match(response.text, /Road network/);
		assert.match(response.text, /Flood risk area/);
		assert.match(response.text, /map-layers-demo(?:-[0-9a-f]{8})?\.js/);
		assert.match(response.text, /data-map-layers-demo/);
	});

	test('GET /consultees/:id/sections/:sectionId/static-map returns a cached image', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			new Response(
				Buffer.from(
					'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
					'base64'
				),
				{
					status: 200,
					headers: { 'content-type': 'image/png' }
				}
			);

		try {
			const response = await request(authDisabledApp).get('/consultees/geo-1/sections/ambulance-trusts/static-map');
			assert.equal(response.status, 200);
			assert.match(response.headers['content-type'] || '', /image\/(svg\+xml|png)/);
			assert.match(response.headers['cache-control'] || '', /max-age=/);
			assert.ok(response.headers.etag);

			const cached = await request(authDisabledApp)
				.get('/consultees/geo-1/sections/ambulance-trusts/static-map')
				.set('If-None-Match', response.headers.etag);
			assert.equal(cached.status, 304);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('GET /consultees/:id/sections/:sectionId/static-map.svg returns svg', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			new Response(
				Buffer.from(
					'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
					'base64'
				),
				{
					status: 200,
					headers: { 'content-type': 'image/png' }
				}
			);

		try {
			const response = await request(authDisabledApp).get('/consultees/geo-1/sections/ambulance-trusts/static-map.svg');
			assert.equal(response.status, 200);
			assert.match(response.headers['content-type'] || '', /image\/svg\+xml/);
			assert.match(response.body.toString(), /<svg/);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('GET /unauthenticated returns 401', async () => {
		const response = await request(authDisabledApp).get('/unauthenticated');
		assert.equal(response.status, 401);
		assert.match(response.text, /Sorry, there is a problem with your login/);
	});

	test('GET /error/firewall-error renders the firewall error page', async () => {
		const response = await request(authDisabledApp).get('/error/firewall-error');
		assert.equal(response.status, 200);
		assert.match(response.text, /Sorry, there is a problem with the service/);
	});

	test('GET /auth is rate limited when auth is enabled', async () => {
		const service = new ManageService(buildManageTestConfig(false));
		const app = createManageTestApp(service, {
			authRateLimiter: buildAuthRateLimiter({ limit: 2, windowMs: 60_000 })
		});

		try {
			const first = await request(app).get('/auth/signin');
			const second = await request(app).get('/auth/signin');
			const third = await request(app).get('/auth/signin');

			assert.notEqual(first.status, 429);
			assert.notEqual(second.status, 429);
			assert.equal(third.status, 429);
		} finally {
			await service.db.$disconnect().catch(() => undefined);
		}
	});
});
