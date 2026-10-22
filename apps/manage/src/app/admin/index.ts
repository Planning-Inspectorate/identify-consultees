import type { ManageService } from '#service';
import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter, RequestHandler } from 'express';
import { Router as createRouter } from 'express';
import {
	buildCaseBoundariesPage,
	buildCaseBoundaryRowPage,
	buildConsulteeAreaRowPage,
	buildConsulteeAreasPage,
	buildDatabaseOverviewPage
} from './database/controller.ts';
import { createRoutes as createImportFromCbosRoutes } from './import-from-cbos/index.ts';
import { createRoutes as createImportReferenceDataRoutes } from './import-reference-data/index.ts';
import { ADMIN_PAGES, adminNavigation } from './navigation.ts';
import { createRoutes as createUploadToBlobRoutes } from './upload-to-blob/index.ts';

/**
 * The admin section: internal tools for loading and checking an environment's data, all under
 * /admin with a menu between them (layout.njk). Self-contained - to take it out of the service,
 * delete this folder and the lines in router.ts and app.ts that name it.
 */

/** Routes taking multipart uploads - core's CSRF check has to let multer read them first. */
export const ADMIN_MULTIPART_ROUTES = ['/admin/upload-to-blob/run'];

/** The header's Admin link, on every page - set before the routes so any page's header can show it. */
export const adminHeaderLink: RequestHandler = (req, res, next) => {
	res.locals.adminLink = { href: '/admin', active: req.path === '/admin' || req.path.startsWith('/admin/') };
	next();
};

export function createAdminRoutes(service: ManageService): IRouter {
	const router = createRouter();

	// every admin page's menu, with the current page marked
	router.use((req, res, next) => {
		res.locals.adminNav = adminNavigation(req.baseUrl + req.path);
		next();
	});

	router.get('/', (_req, res) => {
		res.render('admin/home/view.njk', { pageHeading: 'Admin', pages: ADMIN_PAGES.slice(1) });
	});
	router.get('/database', asyncHandler(buildDatabaseOverviewPage(service)));
	router.get('/database/consultee-areas', asyncHandler(buildConsulteeAreasPage(service)));
	router.get('/database/consultee-areas/:id', asyncHandler(buildConsulteeAreaRowPage(service)));
	router.get('/database/case-boundaries', asyncHandler(buildCaseBoundariesPage(service)));
	router.get('/database/case-boundaries/:id', asyncHandler(buildCaseBoundaryRowPage(service)));
	router.use('/upload-to-blob', createUploadToBlobRoutes(service));
	router.use('/import-reference-data', createImportReferenceDataRoutes(service));
	router.use('/import-from-cbos', createImportFromCbosRoutes(service));

	return router;
}
