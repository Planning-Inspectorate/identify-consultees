import { ManageService } from '#service';
import { addLocalsConfiguration } from '#util/config-middleware.ts';
import { createBaseApp } from '@planning-inspectorate/core/app';
import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import request from 'supertest';
import type { Config } from './config.ts';
import { loadBuildConfig } from './config.ts';
import { configureNunjucks } from './nunjucks.ts';
import { buildAuthRateLimiter, buildRouter } from './router.ts';

function buildTestConfig(authDisabled: boolean): Config {
	const buildConfig = loadBuildConfig();
	return {
		appHostname: 'localhost',
		auth: {
			authority: 'https://login.microsoftonline.com/tenant-id',
			clientId: 'client-id',
			clientSecret: 'client-secret',
			disabled: authDisabled,
			groups: {
				applicationAccess: 'group-id'
			},
			redirectUri: 'http://localhost/auth/redirect',
			signoutUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/logout'
		},
		cacheControl: {
			maxAge: '1d'
		},
		database: {
			connectionString: 'sqlserver://localhost:1434;database=identify-consultees;trustServerCertificate=true'
		},
		gitSha: undefined,
		logLevel: 'silent',
		NODE_ENV: 'development',
		httpPort: 8090,
		srcDir: buildConfig.srcDir,
		session: {
			redisPrefix: 'manage:',
			redis: undefined,
			secret: 'test-session-secret-at-least-32-chars'
		},
		staticDir: buildConfig.staticDir
	};
}

function createTestApp(service: ManageService, authRateLimiter = buildAuthRateLimiter()) {
	service.logger = mockLogger();
	return createBaseApp({
		service,
		configureNunjucks,
		router: buildRouter(service, { authRateLimiter }),
		middlewares: [addLocalsConfiguration()]
	});
}

describe('manage router wiring', () => {
	const authDisabledService = new ManageService(buildTestConfig(true));
	const authDisabledApp = createTestApp(authDisabledService);

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
		assert.match(response.text, /Showing 1 to 50 of 3889 results/);
		assert.match(response.text, />50</);
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
		const service = new ManageService(buildTestConfig(false));
		const app = createTestApp(service, buildAuthRateLimiter({ limit: 2, windowMs: 60_000 }));

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
