import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../nunjucks.ts';
import { buildConsulteeAreasPythonPage, buildRunConsulteeAreasPython } from './controller.ts';

describe('consultee areas python', () => {
	const nunjucks = configureNunjucks();
	const newRes = () => ({ render: mock.fn((view, data) => nunjucks.render(view, data)) });
	const newService = () => ({
		logger: mockLogger(),
		pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas'
	});

	it('renders the page with no rows', async () => {
		const res = newRes();
		const page = buildConsulteeAreasPythonPage();
		await page({}, res);
		assert.strictEqual(res.render.mock.callCount(), 1);
		assert.strictEqual(res.render.mock.calls[0].arguments[0], 'views/consultee-areas-python/view.njk');
		assert.strictEqual(res.render.mock.calls[0].arguments[1].rows, undefined);
	});

	it('renders the rows when the function call succeeds', async (t) => {
		const rows = [{ id: '1', consultee: 'Environment Agency', geometryType: 'Point' }];
		t.mock.method(globalThis, 'fetch', async () => ({
			ok: true,
			json: async () => ({ rows })
		}));

		const res = newRes();
		const run = buildRunConsulteeAreasPython(newService());
		await run({}, res);

		assert.deepStrictEqual(res.render.mock.calls[0].arguments[1].rows, rows);
		assert.strictEqual(res.render.mock.calls[0].arguments[1].error, undefined);
	});

	it('renders an error when the function is unreachable', async (t) => {
		t.mock.method(globalThis, 'fetch', async () => {
			throw new Error('network error');
		});

		const res = newRes();
		const run = buildRunConsulteeAreasPython(newService());
		await run({}, res);

		assert.strictEqual(res.render.mock.calls[0].arguments[1].rows, undefined);
		assert.ok(res.render.mock.calls[0].arguments[1].error);
	});

	it('renders an error when the function responds with a non-OK status', async (t) => {
		t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 500 }));

		const res = newRes();
		const run = buildRunConsulteeAreasPython(newService());
		await run({}, res);

		assert.ok(res.render.mock.calls[0].arguments[1].error);
	});

	it('renders an error without calling fetch when PYTHON_FUNCTION_URL is not configured', async (t) => {
		const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ rows: [] }) }));

		const res = newRes();
		const run = buildRunConsulteeAreasPython({ ...newService(), pythonFunctionUrl: undefined });
		await run({}, res);

		assert.strictEqual(fetchMock.mock.callCount(), 0);
		assert.ok(res.render.mock.calls[0].arguments[1].error);
	});
});
