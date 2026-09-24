import { ManageService } from '#service';
import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../app.ts';
import type { Config } from '../config.ts';
import { loadBuildConfig } from '../config.ts';
import {
	CROSS_ORIGIN_OPENER_POLICY,
	CROSS_ORIGIN_RESOURCE_POLICY,
	OPENFREEMAP_ORIGIN,
	PERMISSIONS_POLICY,
	REFERRER_POLICY,
	STRICT_TRANSPORT_SECURITY_PRODUCTION,
	X_CONTENT_TYPE_OPTIONS,
	X_FRAME_OPTIONS
} from './owasp-headers.ts';

function buildTestConfig(nodeEnv: Config['NODE_ENV']): Config {
	const buildConfig = loadBuildConfig();
	return {
		appHostname: 'localhost',
		pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas',
		auth: {
			authority: 'https://login.microsoftonline.com/tenant-id',
			clientId: 'client-id',
			clientSecret: 'client-secret',
			disabled: true,
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
			connectionString:
				'sqlserver://localhost:1434;database=identify-consultees;user=sa;password=DockerDatabaseP@22word!;trustServerCertificate=true'
		},
		gitSha: undefined,
		logLevel: 'silent',
		NODE_ENV: nodeEnv,
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

describe('HTML security response headers', () => {
	const developmentService = new ManageService(buildTestConfig('development'));
	const productionService = new ManageService(buildTestConfig('production'));
	developmentService.logger = mockLogger();
	productionService.logger = mockLogger();

	const developmentApp = createApp(developmentService);
	const productionApp = createApp(productionService);

	after(async () => {
		await Promise.all([
			developmentService.db.$disconnect().catch(() => undefined),
			productionService.db.$disconnect().catch(() => undefined)
		]);
	});

	test('development HTML responses include OWASP baseline headers and map CSP', async () => {
		const response = await request(developmentApp).get('/');
		assert.equal(response.status, 200);

		assert.equal(response.headers['x-content-type-options'], X_CONTENT_TYPE_OPTIONS);
		assert.equal(response.headers['x-frame-options'], X_FRAME_OPTIONS);
		assert.equal(response.headers['referrer-policy'], REFERRER_POLICY);
		assert.equal(response.headers['permissions-policy'], PERMISSIONS_POLICY);
		assert.equal(response.headers['cross-origin-opener-policy'], CROSS_ORIGIN_OPENER_POLICY);
		assert.equal(response.headers['cross-origin-resource-policy'], CROSS_ORIGIN_RESOURCE_POLICY);
		assert.equal(response.headers['strict-transport-security'], undefined);

		const csp = response.headers['content-security-policy'];
		assert.ok(typeof csp === 'string');
		assert.match(csp, new RegExp(`connect-src[^;]*${OPENFREEMAP_ORIGIN}`));
		assert.match(csp, new RegExp(`img-src[^;]*${OPENFREEMAP_ORIGIN}`));
		assert.match(csp, /worker-src[^;]*blob:/);
		assert.match(csp, /script-src[^;]*'nonce-/);
		assert.doesNotMatch(csp, /upgrade-insecure-requests/);
		assert.doesNotMatch(csp, /tile\.openstreetmap\.org/);
		assert.doesNotMatch(csp, /maps\.googleapis\.com/);
	});

	test('production HTML responses enable HSTS and upgrade-insecure-requests', async () => {
		const response = await request(productionApp).get('/');
		assert.equal(response.status, 200);
		assert.equal(response.headers['strict-transport-security'], STRICT_TRANSPORT_SECURITY_PRODUCTION);

		const csp = response.headers['content-security-policy'];
		assert.ok(typeof csp === 'string');
		assert.match(csp, /upgrade-insecure-requests/);
		assert.match(csp, new RegExp(`connect-src[^;]*${OPENFREEMAP_ORIGIN}`));
	});

	test('consultees results page keeps map-aware CSP', async () => {
		const response = await request(developmentApp).get('/consultees/geo-1');
		assert.equal(response.status, 200);
		const csp = response.headers['content-security-policy'];
		assert.ok(typeof csp === 'string');
		assert.match(csp, new RegExp(`font-src[^;]*${OPENFREEMAP_ORIGIN}`));
		assert.match(csp, /child-src[^;]*blob:/);
	});
});
