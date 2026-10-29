// map layer toggle experiment. TEMPORARY - remove before go-live
// (see README.md's "Before go-live: code to remove")
import { asyncHandler } from '#lib/util/index.ts';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import { buildMapLayersDemoPage } from './controller.ts';

export function createRoutes(): IRouter {
	const router = createRouter({ mergeParams: true });
	const demoPage = buildMapLayersDemoPage();

	router.get('/', asyncHandler(demoPage));

	return router;
}
