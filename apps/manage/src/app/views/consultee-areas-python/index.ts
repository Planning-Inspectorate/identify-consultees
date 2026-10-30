// nearby-area query through the Python function, for comparison during development.
// TEMPORARY - remove before go-live (see README.md's "Before go-live: code to remove")
import { asyncHandler } from '#lib/util/index.ts';
import type { ManageService } from '#service';
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
