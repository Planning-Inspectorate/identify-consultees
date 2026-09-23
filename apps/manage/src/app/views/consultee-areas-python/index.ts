import type { ManageService } from '#service';
import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import { buildConsulteeAreasPythonPage, buildRunConsulteeAreasPython } from './controller.ts';

export function createRoutes(service: ManageService): IRouter {
	const router = createRouter({ mergeParams: true });
	const consulteeAreasPythonPage = buildConsulteeAreasPythonPage();
	const runConsulteeAreasPython = buildRunConsulteeAreasPython(service);

	router.get('/', asyncHandler(consulteeAreasPythonPage));
	router.post('/run', asyncHandler(runConsulteeAreasPython));

	return router;
}
