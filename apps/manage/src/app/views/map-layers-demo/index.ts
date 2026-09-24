import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import { buildMapLayersDemoPage } from './controller.ts';

export function createRoutes(): IRouter {
	const router = createRouter({ mergeParams: true });
	const demoPage = buildMapLayersDemoPage();

	router.get('/', asyncHandler(demoPage));

	return router;
}
