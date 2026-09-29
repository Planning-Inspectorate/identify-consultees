import type { ManageService } from '#service';
import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import { buildConsulteeAreasDirectPage, buildRunConsulteeAreasDirect } from './controller.ts';

export function createRoutes(service: ManageService): IRouter {
	const router = createRouter({ mergeParams: true });
	const consulteeAreasDirectPage = buildConsulteeAreasDirectPage();
	const runConsulteeAreasDirect = buildRunConsulteeAreasDirect(service);

	router.get('/', asyncHandler(consulteeAreasDirectPage));
	router.post('/run', asyncHandler(runConsulteeAreasDirect));

	return router;
}
