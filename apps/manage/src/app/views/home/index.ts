import { asyncHandler } from '#lib/util/index.ts';
import type { ManageService } from '#service';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import { buildHomePage } from './controller.ts';

export function createRoutes(service: ManageService): IRouter {
	const router = createRouter({ mergeParams: true });
	const homePage = buildHomePage(service);

	router.get('/', asyncHandler(homePage));

	return router;
}
