import type { ManageService } from '#service';
import { addLocalsConfiguration } from '#util/config-middleware.ts';
import { ensureEmptyStaticMountDir } from '#util/fingerprint-assets.ts';
import { createStaticAssetsMiddleware } from '#util/static-assets-middleware.ts';
import { createBaseApp } from '@planning-inspectorate/core/app';
import type { Express } from 'express';
import { Router as createRouter } from 'express';
import { configureNunjucks } from './nunjucks.ts';
import { buildRouter } from './router.ts';
import { buildContentSecurityPolicyDirectives } from './security/owasp-headers.ts';
import { buildOwaspSecurityHeadersMiddleware } from './security/security-headers-middleware.ts';

export async function prepareStaticAssetServing(service: ManageService): Promise<void> {
	await ensureEmptyStaticMountDir(service.staticDir);
}

export function createApp(service: ManageService): Express {
	const isProduction = service.secureSession;
	// @planning-inspectorate/core >= 1.14 mounts consumer `middlewares` before its
	// helmet stack, which would then overwrite these headers (e.g. helmet's default
	// HSTS replaces the OWASP values). An outer router runs after helmet while still
	// preceding the app's routes, matching the pre-1.14 ordering.
	const router = createRouter();
	router.use(buildOwaspSecurityHeadersMiddleware({ isProduction }));
	router.use(buildRouter(service));

	return createBaseApp({
		service,
		configureNunjucks,
		router,
		middlewares: [
			createStaticAssetsMiddleware(service.assetsStaticDir),
			addLocalsConfiguration({ devPagesEnabled: service.devPagesEnabled })
		],
		cspDirectives: buildContentSecurityPolicyDirectives({ isProduction }),
		// multer needs the raw multipart body before lusca CSRF can read a token from it - see
		// node_modules/@planning-inspectorate/core/dist/app/csrf.js. The route still gets CSRF
		// coverage: views/admin-upload-to-blob/index.ts runs the lusca check after multer.
		multiPartFormRoutes: ['/admin/upload-to-blob/run']
	});
}
