import type { ManageService } from '#service';
import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import { buildCbosConnectionPage, buildRunCbosConnectionCheck } from './controller.ts';

export function createRoutes(service: ManageService): IRouter {
	const router = createRouter({ mergeParams: true });
	const cbosConnectionPage = buildCbosConnectionPage();
	const runCbosConnectionCheck = buildRunCbosConnectionCheck(service);

	router.get('/', asyncHandler(cbosConnectionPage));
	router.post('/run', asyncHandler(runCbosConnectionCheck));

	return router;
}
