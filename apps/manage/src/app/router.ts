import type { ManageService } from '#service';
import { createRoutesAndGuards as createAuthRoutesAndGuards } from '@planning-inspectorate/core/auth';
import { createMonitoringRoutes } from '@planning-inspectorate/core/controllers';
import { cacheNoCacheMiddleware } from '@planning-inspectorate/core/middleware';
import type { IRouter, RequestHandler } from 'express';
import { Router as createRouter } from 'express';
import rateLimit from 'express-rate-limit';
import { buildAdminHeaderLink } from './admin/access.ts';
import { createAdminRoutes } from './admin/index.ts';
import { buildSanitisingErrorHandler } from './error-handler.ts';
import { createDefraVendorRouter } from './maps/vendor.ts';
import { createRoutes as createConsulteeRoutes } from './views/consultees/index.ts';
import { createFooterRoutes } from './views/footer/index.ts';
import { createRoutes as createHelpRoutes } from './views/help/index.ts';
import { createRoutes as createHomeRoutes } from './views/home/index.ts';
import { createErrorRoutes } from './views/static/error/index.ts';

export type AuthRateLimiterOptions = {
	windowMs?: number;
	limit?: number;
};

/**
 * Limit auth endpoints to reduce abuse of MSAL sign-in and redirect handlers.
 * @see https://codeql.github.com/codeql-query-help/javascript/js-missing-rate-limiting/
 */
export function buildAuthRateLimiter(options: AuthRateLimiterOptions = {}): RequestHandler {
	return rateLimit({
		windowMs: options.windowMs ?? 15 * 60 * 1000,
		limit: options.limit ?? 100,
		standardHeaders: 'draft-8',
		legacyHeaders: false,
		// Tests and local setups often omit X-Forwarded-For
		validate: { xForwardedForHeader: false }
	});
}

export type BuildRouterOptions = {
	authRateLimiter?: RequestHandler;
};

/**
 * Main app router
 */
export function buildRouter(service: ManageService, options: BuildRouterOptions = {}): IRouter {
	const router = createRouter();
	const monitoringRoutes = createMonitoringRoutes(service);
	const { router: authRoutes, guards: authGuards } = createAuthRoutesAndGuards(service);
	const homeRoutes = createHomeRoutes(service);
	const consulteeRoutes = createConsulteeRoutes(service);

	const adminRoutes = createAdminRoutes(service);
	const authRateLimiter = options.authRateLimiter ?? buildAuthRateLimiter();

	router.use('/', monitoringRoutes);
	// vendor webpack lazy chunks keep stable filenames across package versions, so
	// they revalidate (max-age=0) rather than risk a stale chunk booting against a
	// new fingerprinted entry - a mismatch crashes the map on module-id lookup
	router.use(createDefraVendorRouter());

	// don't cache responses, note no-cache allows some caching, but with revalidation
	// see https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control#no-cache
	router.use(cacheNoCacheMiddleware);

	router.get('/unauthenticated', (req, res) => res.status(401).render('views/errors/401.njk'));

	router.get('/signed-out', (_req, res) => {
		res.render('views/signed-out/view.njk', {
			signInHref: service.authDisabled ? '/' : '/auth/signin'
		});
	});

	// the footer's content pages (terms, accessibility, cookies, contact) stay reachable
	// without signing in - policy pages on a service shouldn't sit behind its login
	router.use('/', createFooterRoutes());

	if (!service.authDisabled) {
		service.logger.info('registering auth routes');
		router.use('/auth', authRateLimiter, authRoutes);

		// all subsequent routes require auth

		// check logged in
		router.use(authGuards.assertIsAuthenticated);
		// check group membership
		router.use(authGuards.assertGroupAccess);
	} else {
		service.logger.warn('auth disabled; auth routes and guards skipped');

		// Keep the header "Sign out" link working locally without Entra
		router.get('/auth/signout', (req, res, next) => {
			req.session.destroy((error) => {
				if (error) {
					next(error);
					return;
				}
				res.setHeader('Clear-Site-Data', '*');
				res.clearCookie('connect.sid', { path: '/' });
				res.redirect('/signed-out');
			});
		});
	}

	// the header's Admin link, for those who may use the admin section - see admin/access.ts
	router.use(buildAdminHeaderLink(service));
	router.use('/', homeRoutes);
	router.use('/consultees', consulteeRoutes);
	// the user guide - behind sign-in, as it describes how rulesets are changed
	router.use('/help', createHelpRoutes());
	// the admin section - see admin/index.ts
	router.use('/admin', adminRoutes);
	router.use('/error', createErrorRoutes(service));

	// last: route errors render generic copy (full detail goes to the logs only) rather
	// than reaching the core default handler, which renders error.message to the page
	router.use(buildSanitisingErrorHandler(service));

	return router;
}
