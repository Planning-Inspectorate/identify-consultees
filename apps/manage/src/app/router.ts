import type { ManageService } from '#service';
import { createRoutesAndGuards as createAuthRoutesAndGuards } from '@planning-inspectorate/core/auth';
import { createMonitoringRoutes } from '@planning-inspectorate/core/controllers';
import { cacheNoCacheMiddleware } from '@planning-inspectorate/core/middleware';
import type { IRouter, RequestHandler } from 'express';
import { Router as createRouter } from 'express';
import rateLimit from 'express-rate-limit';
import { createRoutes as createConsulteeAreasPythonRoutes } from './views/consultee-areas-python/index.ts';
import { createRoutes as createHomeRoutes } from './views/home/index.ts';
import { createRoutes as createItemRoutes } from './views/items/index.ts';
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
	const itemsRoutes = createItemRoutes(service);
	const consulteeAreasPythonRoutes = createConsulteeAreasPythonRoutes(service);
	const authRateLimiter = options.authRateLimiter ?? buildAuthRateLimiter();

	router.use('/', monitoringRoutes);

	// don't cache responses, note no-cache allows some caching, but with revalidation
	// see https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control#no-cache
	router.use(cacheNoCacheMiddleware);

	router.get('/unauthenticated', (req, res) => res.status(401).render('views/errors/401.njk'));

	router.get('/signed-out', (_req, res) => {
		res.render('views/signed-out/view.njk', {
			signInHref: service.authDisabled ? '/' : '/auth/signin'
		});
	});

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

	router.use('/', homeRoutes);
	router.use('/items', itemsRoutes);
	router.use('/consultee-areas-python', consulteeAreasPythonRoutes);
	router.use('/error', createErrorRoutes(service));

	return router;
}
