import type { ManageService } from '#service';
import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import { createCbosCaseRefresh } from '../../cbos/refresh-cases.ts';
import { buildHomePage, buildRefreshCases } from './controller.ts';

export function createRoutes(service: ManageService): IRouter {
	const router = createRouter({ mergeParams: true });
	const homePage = buildHomePage(service);

	router.get('/', asyncHandler(homePage));
	router.post('/refresh-cases', buildRefreshCases(service, createCbosCaseRefresh(service)));

	return router;
}
