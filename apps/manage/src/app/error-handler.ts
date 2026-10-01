import type { ManageService } from '#service';
import type { ErrorRequestHandler } from 'express';

/**
 * Catch-all error handler for this app's routes, registered last in the router so
 * route errors are handled here rather than reaching @planning-inspectorate/core's
 * default handler - which renders `error.message` to the page. That's fine for the
 * Prisma/Redis errors it deliberately wraps, but an unrecognised error (a render
 * failure, an upstream fetch error, a bug) can carry internal detail - file paths,
 * URLs, query text - that must never reach a response. The full error is still
 * logged; the page gets generic copy only.
 */
export function buildSanitisingErrorHandler(service: ManageService): ErrorRequestHandler {
	return (error, _req, res, next) => {
		service.logger.error({ err: error }, 'unhandled error in route handler');

		if (res.headersSent) {
			next(error);
			return;
		}

		const statusCode =
			typeof error?.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 600
				? error.statusCode
				: 500;

		// no `error` passed to the view - 500.njk renders error/stack only when given one
		res.status(statusCode).render('views/errors/500.njk', {
			pageHeading: 'Sorry, there is a problem with the service'
		});
	};
}
