// worked Defra map examples, mounted at /components/interactive-map.
// TEMPORARY - remove before go-live (see README.md's "Before go-live: code to remove")
import { asyncHandler } from '#lib/util/index.ts';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import {
	buildInteractiveMapExamplePage,
	buildInteractiveMapExamplesIndexPage,
	buildInteractiveMapStaticMap
} from './controller.ts';

export function createRoutes(): IRouter {
	const router = createRouter({ mergeParams: true });

	router.get('/', asyncHandler(buildInteractiveMapExamplesIndexPage()));
	router.get('/:example/static-map.svg', asyncHandler(buildInteractiveMapStaticMap(true)));
	router.get('/:example/static-map', asyncHandler(buildInteractiveMapStaticMap()));
	router.get('/:example', asyncHandler(buildInteractiveMapExamplePage()));

	return router;
}
