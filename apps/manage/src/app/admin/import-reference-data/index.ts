import type { ManageService } from '#service';
import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import {
	buildClearConsulteeAreas,
	buildImportReferenceDataPage,
	buildRunImportCaseBoundaries,
	buildRunImportConsulteeAreaGroup
} from './controller.ts';

export function createRoutes(service: ManageService): IRouter {
	const router = createRouter({ mergeParams: true });

	router.get('/', asyncHandler(buildImportReferenceDataPage(service)));
	// a group of the reference data, from its newest file in blob storage
	router.post('/run-consultee-area-group', asyncHandler(buildRunImportConsulteeAreaGroup(service)));
	router.post('/clear-consultee-areas', asyncHandler(buildClearConsulteeAreas(service)));
	router.post('/run-case-boundaries', asyncHandler(buildRunImportCaseBoundaries(service)));

	return router;
}
