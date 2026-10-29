// GOV.UK component showcase (plus Defra map examples under /interactive-map).
// TEMPORARY - remove before go-live (see README.md's "Before go-live: code to remove")
import { asyncHandler } from '#lib/util/index.ts';
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
