import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { buildSanitisingErrorHandler } from './error-handler.ts';

describe('buildSanitisingErrorHandler', () => {
	const newRes = (headersSent = false) => {
		const res = {
			headersSent,
			status: mock.fn(() => res),
			render: mock.fn()
		};
		return res;
	};
	const newService = () => ({ logger: mockLogger() });

	it('delegates to the default handler when headers are already sent', () => {
		const handler = buildSanitisingErrorHandler(newService());
		const res = newRes(true);
		const next = mock.fn();
		const error = new Error('broken');

		handler(error, {}, res, next);

		assert.strictEqual(next.mock.callCount(), 1);
		assert.strictEqual(next.mock.calls[0].arguments[0], error);
		assert.strictEqual(res.status.mock.callCount(), 0);
		assert.strictEqual(res.render.mock.callCount(), 0);
	});

	it('renders the 500 page for a plain error', () => {
		const handler = buildSanitisingErrorHandler(newService());
		const res = newRes();
		const next = mock.fn();

		handler(new Error('broken'), {}, res, next);

		assert.strictEqual(next.mock.callCount(), 0);
		assert.strictEqual(res.status.mock.calls[0].arguments[0], 500);
		assert.strictEqual(res.render.mock.calls[0].arguments[0], 'views/errors/500.njk');
	});

	it('renders a nullish error as 500', () => {
		const handler = buildSanitisingErrorHandler(newService());
		const res = newRes();
		const next = mock.fn();

		handler(null, {}, res, next);

		assert.strictEqual(res.status.mock.calls[0].arguments[0], 500);
		assert.strictEqual(res.render.mock.calls[0].arguments[0], 'views/errors/500.njk');
	});

	it('uses a valid error statusCode', () => {
		const handler = buildSanitisingErrorHandler(newService());
		const res = newRes();
		const next = mock.fn();
		const error = Object.assign(new Error('upstream failed'), { statusCode: 503 });

		handler(error, {}, res, next);

		assert.strictEqual(res.status.mock.calls[0].arguments[0], 503);
		assert.strictEqual(res.render.mock.calls[0].arguments[0], 'views/errors/500.njk');
	});

	for (const [label, statusCode] of [
		['non-numeric', '404'],
		['below the error range', 200],
		['above the error range', 700]
	]) {
		it(`falls back to 500 for a ${label} statusCode`, () => {
			const handler = buildSanitisingErrorHandler(newService());
			const res = newRes();
			const next = mock.fn();
			const error = Object.assign(new Error('broken'), { statusCode });

			handler(error, {}, res, next);

			assert.strictEqual(res.status.mock.calls[0].arguments[0], 500);
			assert.strictEqual(res.render.mock.calls[0].arguments[0], 'views/errors/500.njk');
		});
	}
});
