import type { ManageService } from '#service';
import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import {
	buildImportReferenceDataPage,
	buildRunImportCaseBoundaries,
	buildRunImportConsulteeAreas
} from './controller.ts';

export function createRoutes(service: ManageService): IRouter {
	const router = createRouter({ mergeParams: true });
	const importReferenceDataPage = buildImportReferenceDataPage(service);
	const runImportConsulteeAreas = buildRunImportConsulteeAreas(service);
	const runImportCaseBoundaries = buildRunImportCaseBoundaries(service);

	router.get('/', asyncHandler(importReferenceDataPage));
	router.post('/run-consultee-areas', asyncHandler(runImportConsulteeAreas));
	router.post('/run-case-boundaries', asyncHandler(runImportCaseBoundaries));

	return router;
}
