// nearby-area query straight from Node, for comparison during development.
// TEMPORARY - remove before go-live (see README.md's "Before go-live: code to remove")
import { asyncHandler } from '#lib/util/index.ts';
import type { ManageService } from '#service';
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
