import type { ManageService } from '#service';
import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import {
	buildErrorTest500Page,
	buildErrorTestCsrfCheckPage,
	buildErrorTestIndexPage,
	buildErrorTestRateLimitedPage,
	buildErrorTestStatusPage
} from './controller.ts';
import type { ErrorTestIndexViewModel } from './view-model.ts';

describe('error scenarios index page', () => {
	test('renders the index with a scenario per error state', () => {
		const handler = buildErrorTestIndexPage();
		const mockRes = { render: mock.fn() };

		handler({} as never, mockRes as never, mock.fn());

		assert.equal(mockRes.render.mock.callCount(), 1);
		const [view, model] = mockRes.render.mock.calls[0].arguments as [string, ErrorTestIndexViewModel];
		assert.equal(view, 'views/error-test/view.njk');
		assert.equal(model.pageHeading, 'Error scenarios');
		assert.equal(model.csrfAccepted, false);
		assert.equal(model.csrfCheckAction, '/error-test/csrf-check');
		assert.equal(model.rateLimitedHref, '/error-test/rate-limited');
		assert.deepEqual(
			model.statusPages.map((page) => page.href),
			['/error-test/401', '/error-test/403', '/error-test/404', '/error-test/500']
		);
		assert.deepEqual(
			model.livePages.map((page) => page.href),
			['/unauthenticated', '/error/firewall-error', '/error-test/not-a-page']
		);
	});
});

describe('status page renders', () => {
	for (const status of [401, 403] as const) {
		test(`renders views/errors/${status}.njk with no view model`, () => {
			const handler = buildErrorTestStatusPage(status);
			const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };

			handler({} as never, mockRes as never, mock.fn());

			assert.equal(mockRes.status.mock.calls[0].arguments[0], status);
			assert.deepEqual(mockRes.render.mock.calls[0].arguments, [`views/errors/${status}.njk`, {}]);
		});
	}

	test('404 mirrors the record not-found render with a pageHeading', () => {
		const handler = buildErrorTestStatusPage(404);
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };

		handler({} as never, mockRes as never, mock.fn());

		assert.deepEqual(mockRes.render.mock.calls[0].arguments, [
			'views/errors/404.njk',
			{ pageHeading: 'Page not found' }
		]);
	});
});

describe('deliberate 500', () => {
	test('passes an error to next and logs a warning', () => {
		const logger = mockLogger();
		const service = { logger } as unknown as ManageService;
		const handler = buildErrorTest500Page(service);
		const next = mock.fn();

		handler({} as never, {} as never, next);

		assert.equal(next.mock.callCount(), 1);
		const error = next.mock.calls[0].arguments[0] as Error;
		assert.match(error.message, /deliberate test error/);
		assert.equal(logger.warn.mock.callCount(), 1);
	});
});

describe('csrf check success page', () => {
	test('renders the index with the confirmation flag', () => {
		const handler = buildErrorTestCsrfCheckPage();
		const mockRes = { render: mock.fn() };

		handler({} as never, mockRes as never, mock.fn());

		const [view, model] = mockRes.render.mock.calls[0].arguments as [string, ErrorTestIndexViewModel];
		assert.equal(view, 'views/error-test/view.njk');
		assert.equal(model.csrfAccepted, true);
	});
});

describe('rate limited page', () => {
	test('sends a plain-text hint', () => {
		const handler = buildErrorTestRateLimitedPage();
		const mockRes = { type: mock.fn(() => mockRes), send: mock.fn() };

		handler({} as never, mockRes as never, mock.fn());

		assert.equal(mockRes.type.mock.calls[0].arguments[0], 'text/plain');
		assert.match(mockRes.send.mock.calls[0].arguments[0] as string, /Not rate limited yet/);
	});
});
