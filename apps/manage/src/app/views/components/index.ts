import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import { createRoutes as createInteractiveMapExamplesRoutes } from '../interactive-map-examples/index.ts';
import { buildComponentDetailPage, buildComponentsIndexPage } from './controller.ts';

export function createRoutes(): IRouter {
	const router = createRouter({ mergeParams: true });
	const indexPage = buildComponentsIndexPage();
	const detailPage = buildComponentDetailPage();

	// mounted before /:component so "interactive-map" is not read as a GOV.UK
	// Frontend component name
	router.use('/interactive-map', createInteractiveMapExamplesRoutes());
	router.get('/', asyncHandler(indexPage));
	router.get('/:component', asyncHandler(detailPage));

	return router;
}
