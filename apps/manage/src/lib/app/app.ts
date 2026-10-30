import bodyParser from 'body-parser';
import express, { type Express, type Handler, type IRouter } from 'express';
import type { Environment } from 'nunjucks';
import { initContentSecurityPolicyMiddlewares, type HelmetCspDirectives } from '../middleware/csp-middleware.ts';
import { buildDefaultErrorHandlerMiddleware, notFoundHandler } from '../middleware/errors.ts';
import { buildLogRequestsMiddleware } from '../middleware/log-requests.ts';
import { initSessionMiddleware } from '../util/session.ts';
import type { BaseService } from './base-service.ts';
import { buildCsrfMiddleware, type RouteMatch } from './csrf.ts';

interface BaseAppOptions {
	service: BaseService;
	router: IRouter;
	middlewares: Handler[];
	configureNunjucks: () => Environment;
	cspDirectives?: HelmetCspDirectives;
	/**
	 * Routes which accept multipart/form-data (such as file uploads)
	 * CSRF is bypassed only for multipart/form-data POST requests to these routes, and must be added after the multer middleware
	 *
	 * Can either be an exact-match string, or a regex
	 * All routes must be a POST.
	 */
	multiPartFormRoutes?: RouteMatch[];
	/**
	 * Passed to lusca.csrf blocklist option - skips CSRF protection
	 * Exact match only
	 * @see https://github.com/krakenjs/lusca#luscacsrfoptions
	 */
	csrfRouteBypass?: string[];
}

export function createBaseApp({
	service,
	router,
	middlewares,
	configureNunjucks,
	cspDirectives = cspDirectiveDefaults,
	csrfRouteBypass = [],
	multiPartFormRoutes = []
}: BaseAppOptions): Express {
	// create an express app, and configure it for our usage
	const app = express();

	const logRequests = buildLogRequestsMiddleware(service.logger);
	app.use(logRequests);

	// configure body-parser, to populate req.body
	// see https://expressjs.com/en/resources/middleware/body-parser.html
	app.use(bodyParser.urlencoded({ extended: true }));
	app.use(bodyParser.json());

	const sessionMiddleware = initSessionMiddleware({
		redis: service.redisClient,
		secure: service.secureSession,
		secret: service.sessionSecret,
		...service.otherSessionOptions
	});
	app.use(sessionMiddleware);

	app.use(...middlewares);
	app.use(buildCsrfMiddleware(csrfRouteBypass, multiPartFormRoutes));
	app.use(...initContentSecurityPolicyMiddlewares(cspDirectives));

	// static files
	app.use(express.static(service.staticDir, service.cacheControl));

	if (configureNunjucks) {
		const nunjucksEnvironment = configureNunjucks();
		// Set the express view engine to nunjucks
		// calls to res.render will use nunjucks
		nunjucksEnvironment.express(app);
		app.set('view engine', 'njk');
	}

	// register the router, which will define any subpaths
	// any paths not defined will return 404 by default
	app.use('/', router);
	app.use(notFoundHandler);

	const defaultErrorHandler = buildDefaultErrorHandlerMiddleware(service.logger);
	// catch/handle errors last
	app.use(defaultErrorHandler);

	return app;
}

const cspDirectiveDefaults: HelmetCspDirectives = {
	scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals?.cspNonce}'`],
	defaultSrc: ["'self'"],
	connectSrc: ["'self'"],
	fontSrc: ["'self'"],
	imgSrc: ["'self'"],
	styleSrc: ["'self'"]
};
