import type { ManageService } from '#service';
import { addLocalsConfiguration } from '#util/config-middleware.ts';
import { ensureEmptyStaticMountDir } from '#util/fingerprint-assets.ts';
import { createStaticAssetsMiddleware } from '#util/static-assets-middleware.ts';
import { createBaseApp } from '@planning-inspectorate/core/app';
import type { Express } from 'express';
import { configureNunjucks } from './nunjucks.ts';
import { buildRouter } from './router.ts';
import { buildContentSecurityPolicyDirectives } from './security/owasp-headers.ts';
import { buildOwaspSecurityHeadersMiddleware } from './security/security-headers-middleware.ts';

export async function prepareStaticAssetServing(service: ManageService): Promise<void> {
	await ensureEmptyStaticMountDir(service.staticDir);
}

export function createApp(service: ManageService): Express {
	const isProduction = service.secureSession;
	const router = buildRouter(service);

	return createBaseApp({
		service,
		configureNunjucks,
		router,
		middlewares: [
			createStaticAssetsMiddleware(service.assetsStaticDir),
			buildOwaspSecurityHeadersMiddleware({ isProduction }),
			addLocalsConfiguration()
		],
		cspDirectives: buildContentSecurityPolicyDirectives({ isProduction })
	});
}
