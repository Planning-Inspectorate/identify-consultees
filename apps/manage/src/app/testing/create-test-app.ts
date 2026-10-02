/**
 * Shared Express app factory for HTTP integration and Playwright e2e tests.
 * Auth is disabled so journeys can run without Entra.
 */
import { ManageService } from '#service';
import { addLocalsConfiguration } from '#util/config-middleware.ts';
import { createStaticAssetsMiddleware } from '#util/static-assets-middleware.ts';
import { createBaseApp } from '@planning-inspectorate/core/app';
import { mockLogger } from '@planning-inspectorate/core/testing';
import type { Express } from 'express';
import type { Config } from '../config.ts';
import { loadBuildConfig } from '../config.ts';
import { configureNunjucks } from '../nunjucks.ts';
import { buildAuthRateLimiter, buildRouter } from '../router.ts';

export type CreateManageTestAppOptions = {
	authDisabled?: boolean;
	authRateLimiter?: ReturnType<typeof buildAuthRateLimiter>;
};

export function buildManageTestConfig(authDisabled = true): Config {
	const buildConfig = loadBuildConfig();
	return {
		appHostname: 'localhost',
		pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas',
		pythonFunctionApiKey: 'test-function-api-key',
		blobStore: undefined,
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
			// CI's e2e server runs against a SQL Server container on a dynamically assigned port
			// (see .azure/pipelines/pr.yml's "Start SQL Server for tests" step) - fall back to the
			// docker-compose port for local `npm test` / `npm run test:e2e`
			connectionString:
				process.env.SQL_CONNECTION_STRING ??
				'sqlserver://localhost:1434;database=identify-consultees;user=sa;password=DockerDatabaseP@22word!;trustServerCertificate=true'
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

export function createManageTestApp(service: ManageService, options: CreateManageTestAppOptions = {}): Express {
	const authRateLimiter = options.authRateLimiter ?? buildAuthRateLimiter();
	service.logger = mockLogger() as typeof service.logger;
	return createBaseApp({
		service,
		configureNunjucks,
		router: buildRouter(service, { authRateLimiter }),
		middlewares: [createStaticAssetsMiddleware(service.assetsStaticDir), addLocalsConfiguration()],
		multiPartFormRoutes: ['/admin/upload-to-blob/run']
	});
}

export function createManageTestService(authDisabled = true): ManageService {
	return new ManageService(buildManageTestConfig(authDisabled));
}
