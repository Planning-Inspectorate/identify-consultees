import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import {
	buildDemoStaticMap,
	buildMapExternalControlsDemoPage,
	buildMapExternalControlsDemoSubmit
} from './controller.ts';

export function createRoutes(): IRouter {
	const router = createRouter({ mergeParams: true });

	// static-map image first: '/static-map' must not be caught by a greedy pattern
	router.get('/static-map.svg', asyncHandler(buildDemoStaticMap(true)));
	router.get('/static-map', asyncHandler(buildDemoStaticMap()));
	router.get('/', asyncHandler(buildMapExternalControlsDemoPage()));
	router.post('/', asyncHandler(buildMapExternalControlsDemoSubmit()));

	return router;
}
