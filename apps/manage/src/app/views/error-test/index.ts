// error-scenario index for QA. TEMPORARY - remove before go-live
// (see README.md's "Before go-live: code to remove")
import type { ManageService } from '#service';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import rateLimit from 'express-rate-limit';
import {
	buildErrorTest500Page,
	buildErrorTestCsrfCheckPage,
	buildErrorTestIndexPage,
	buildErrorTestRateLimitedPage,
	buildErrorTestStatusPage
} from './controller.ts';

export function createRoutes(service: ManageService): IRouter {
	const router = createRouter({ mergeParams: true });

	// a tiny limiter for the 429 demo - same shape as router.ts's auth limiter,
	// small enough to trip by hand (the auth limit itself is 100 per 15 minutes)
	const demoRateLimiter = rateLimit({
		windowMs: 60_000,
		limit: 3,
		standardHeaders: 'draft-8',
		legacyHeaders: false,
		validate: { xForwardedForHeader: false }
	});

	router.get('/', buildErrorTestIndexPage());
	router.get('/500', buildErrorTest500Page(service));
	router.get('/401', buildErrorTestStatusPage(401));
	router.get('/403', buildErrorTestStatusPage(403));
	router.get('/404', buildErrorTestStatusPage(404));
	router.post('/csrf-check', buildErrorTestCsrfCheckPage());
	router.get('/rate-limited', demoRateLimiter, buildErrorTestRateLimitedPage());

	return router;
}
