import type { ManageService } from '#service';
import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import { buildImportFromCbosPage, buildRunImportFromCbos } from './controller.ts';

export function createRoutes(service: ManageService): IRouter {
	const router = createRouter({ mergeParams: true });
	const importFromCbosPage = buildImportFromCbosPage(service);
	const runImportFromCbos = buildRunImportFromCbos(service);

	router.get('/', asyncHandler(importFromCbosPage));
	router.post('/run', asyncHandler(runImportFromCbos));

	return router;
}
