import type { ManageService } from '#service';
import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import { buildCbosFilePage, buildCbosFilesPage } from './controller.ts';

export function createRoutes(service: ManageService): IRouter {
	const router = createRouter({ mergeParams: true });

	router.get('/', asyncHandler(buildCbosFilesPage(service)));
	router.get('/:guid/:version', asyncHandler(buildCbosFilePage(service)));

	return router;
}
