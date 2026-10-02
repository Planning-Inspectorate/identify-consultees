import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import { buildComponentDetailPage, buildComponentsIndexPage } from './controller.ts';

export function createRoutes(): IRouter {
	const router = createRouter({ mergeParams: true });
	const indexPage = buildComponentsIndexPage();
	const detailPage = buildComponentDetailPage();

	router.get('/', asyncHandler(indexPage));
	router.get('/:component', asyncHandler(detailPage));

	return router;
}
