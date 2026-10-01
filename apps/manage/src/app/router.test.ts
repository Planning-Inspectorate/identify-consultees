import { ManageService } from '#service';
import { loadCaseBoundaries } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import request from 'supertest';
import { buildAuthRateLimiter } from './router.ts';
import { buildManageTestConfig, createManageTestApp, createManageTestService } from './testing/create-test-app.ts';

// a fixed id, rather than depending on whatever sample data may or may not be seeded (CI's
// database is migrated but never seeded - see .azure/pipelines/pr.yml)
const homePageTestCaseId = '33333333-3333-3333-3333-333333333333';

describe('manage router wiring', () => {
	const authDisabledService = createManageTestService(true);
	const authDisabledApp = createManageTestApp(authDisabledService);

	before(async () => {
		await authDisabledService.db.$executeRaw`DELETE FROM case_boundary WHERE id = ${homePageTestCaseId}`;
		await loadCaseBoundaries(authDisabledService.db, {
			type: 'FeatureCollection',
			features: [
				{
					id: homePageTestCaseId,
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [-1.5, 52.5] },
					properties: { caseReference: 'ZZ000001', caseName: 'Router Test Fixture Wind Farm' }
				}
			]
		});
	});

	after(async () => {
		await authDisabledService.db.$executeRaw`DELETE FROM case_boundary WHERE id = ${homePageTestCaseId}`;
		await authDisabledService.db.$disconnect().catch(() => undefined);
	});

	test('GET / renders the identify consultees home page', async () => {
		const response = await request(authDisabledApp).get('/?q=Router+Test+Fixture');
		assert.equal(response.status, 200);
		assert.match(response.text, /Identify consultees for an infrastructure project/);
		assert.match(response.text, /Router Test Fixture Wind Farm/);
		assert.match(response.text, new RegExp(`/consultees/${homePageTestCaseId}`));
	});

	test('GET /signed-out renders the signed out page', async () => {
		const response = await request(authDisabledApp).get('/signed-out');
		assert.equal(response.status, 200);
		assert.match(response.text, /You have signed out/);
		assert.match(response.text, /Sign in again/);
		assert.match(response.text, /href="\/"/);
	});

	test('GET /signed-out links to /auth/signin when auth is enabled', async () => {
		const service = createManageTestService(false);
		const app = createManageTestApp(service);
		try {
			const response = await request(app).get('/signed-out');
			assert.equal(response.status, 200);
			assert.match(response.text, /href="\/auth\/signin"/);
		} finally {
			await service.db.$disconnect().catch(() => undefined);
		}
	});

	test('GET /auth/signout redirects to /signed-out when auth is disabled', async () => {
		const response = await request(authDisabledApp).get('/auth/signout');
		assert.equal(response.status, 302);
		assert.equal(response.headers.location, '/signed-out');
	});

	test('GET /?pageSize=50 honours the requested page size', async () => {
		const response = await request(authDisabledApp).get('/?q=Router+Test+Fixture&pageSize=50');
		assert.equal(response.status, 200);
		assert.match(response.text, /Showing 1 to 1 of 1 results/);
		assert.match(response.text, />50</);
	});

	test('GET /consultees/:id renders the ruleset picker page', async () => {
		const response = await request(authDisabledApp).get(`/consultees/${homePageTestCaseId}`);
		assert.equal(response.status, 200);
		assert.match(response.text, /Choose a ruleset/);
		assert.match(response.text, /Router Test Fixture Wind Farm/);
		assert.match(response.text, /Example ruleset/);
	});

	test('GET /consultees/:id/results runs the ruleset and renders the results page', async () => {
		const response = await request(authDisabledApp).get(
			`/consultees/${homePageTestCaseId}/results?ruleset=example-ruleset`
		);
		assert.equal(response.status, 200);
		assert.match(response.text, /Consultees identified for/);
		assert.match(response.text, /Ruleset used: Example ruleset/);
	});

	test('GET /consultees/:id/results 404s for an unknown ruleset', async () => {
		const response = await request(authDisabledApp).get(
			`/consultees/${homePageTestCaseId}/results?ruleset=not-a-real-ruleset`
		);
		assert.equal(response.status, 404);
	});

	test('GET /consultees/:id 404s for an unknown case', async () => {
		const response = await request(authDisabledApp).get('/consultees/99999999-9999-9999-9999-999999999999');
		assert.equal(response.status, 404);
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

	test('GET /consultees/:id/results/static-map returns a cached image', async () => {
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
			const response = await request(authDisabledApp).get(
				`/consultees/${homePageTestCaseId}/results/static-map?ruleset=example-ruleset`
			);
			assert.equal(response.status, 200);
			assert.match(response.headers['content-type'] || '', /image\/(svg\+xml|png)/);
			assert.match(response.headers['cache-control'] || '', /max-age=/);
			assert.ok(response.headers.etag);

			const cached = await request(authDisabledApp)
				.get(`/consultees/${homePageTestCaseId}/results/static-map?ruleset=example-ruleset`)
				.set('If-None-Match', response.headers.etag);
			assert.equal(cached.status, 304);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('GET /consultees/:id/results/static-map.svg returns svg', async () => {
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
			const response = await request(authDisabledApp).get(
				`/consultees/${homePageTestCaseId}/results/static-map.svg?ruleset=example-ruleset`
			);
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
