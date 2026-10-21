import type { ManageService } from '#service';
import type { Handler } from 'express';
import type { ErrorTestIndexViewModel } from './view-model.ts';

function errorTestIndexModel(csrfAccepted = false): ErrorTestIndexViewModel {
	return {
		pageHeading: 'Error scenarios',
		statusPages: [
			{
				href: '/error-test/401',
				label: '401',
				description: 'the login problem page a failed sign-in lands on (the real route is /unauthenticated)'
			},
			{
				href: '/error-test/403',
				label: '403',
				description:
					'the page signed-in users outside the access group see - otherwise only reachable with a real group-less Entra account'
			},
			{
				href: '/error-test/404',
				label: '404',
				description: 'the page routes render for an unknown record'
			},
			{
				href: '/error-test/500',
				label: '500',
				description:
					'deliberately throws, exercising the sanitising error handler end-to-end - the error message must not appear on the page'
			}
		],
		livePages: [
			{ href: '/unauthenticated', label: 'Login problem', description: 'the real 401 route' },
			{
				href: '/error/firewall-error',
				label: 'Firewall error',
				description: 'the page Front Door redirects blocked requests to'
			},
			{
				href: '/error-test/not-a-page',
				label: 'Catch-all 404',
				description: 'an unmatched path, handled by the default not-found handler'
			}
		],
		csrfCheckAction: '/error-test/csrf-check',
		rateLimitedHref: '/error-test/rate-limited',
		csrfAccepted
	};
}

/**
 * Index of every error state QA can reproduce by hand. Mounted with the other
 * dev pages, so it goes away with them before go-live.
 */
export function buildErrorTestIndexPage(): Handler {
	return (_req, res) => {
		res.render('views/error-test/view.njk', errorTestIndexModel());
	};
}

/**
 * Render the real error template for a status, mirroring how the app produces it:
 * /unauthenticated and the group guard render 401/403 with no view model, while
 * record not-founds pass a pageHeading.
 */
export function buildErrorTestStatusPage(status: 401 | 403 | 404): Handler {
	return (_req, res) => {
		res.status(status).render(`views/errors/${status}.njk`, status === 404 ? { pageHeading: 'Page not found' } : {});
	};
}

/**
 * Deliberately fails, so the 500 pipeline - the sanitising error handler and
 * views/errors/500.njk - can be exercised end-to-end.
 */
export function buildErrorTest500Page(service: ManageService): Handler {
	return (_req, _res, next) => {
		service.logger.warn('error test page requested - failing deliberately');
		next(new Error('deliberate test error from /error-test/500 - must not appear on the page'));
	};
}

/**
 * Success page for the CSRF demo form - only reached when a valid _csrf is
 * posted; the tokenless form on the index fails in lusca before it gets here.
 */
export function buildErrorTestCsrfCheckPage(): Handler {
	return (_req, res) => {
		res.render('views/error-test/view.njk', errorTestIndexModel(true));
	};
}

/**
 * Sits behind a tiny rate limiter so QA can see the real plain-text 429
 * response by refreshing - what the auth endpoints return past their limit.
 */
export function buildErrorTestRateLimitedPage(): Handler {
	return (_req, res) => {
		res.type('text/plain').send('Not rate limited yet - keep refreshing to hit the 3-per-minute limit.');
	};
}
