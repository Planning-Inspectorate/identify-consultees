import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../nunjucks.ts';
import { buildCbosConnectionPage, buildRunCbosConnectionCheck, cbosHealthUrl } from './controller.ts';

describe('admin CBOS connection', () => {
	const nunjucks = configureNunjucks();
	const newRes = () => ({ render: mock.fn((view, data) => nunjucks.render(view, data)) });
	const newService = () => ({
		logger: mockLogger(),
		pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas',
		pythonFunctionApiKey: 'test-function-api-key'
	});
	const viewModel = (res: ReturnType<typeof newRes>) => res.render.mock.calls[0].arguments[1];
	const respondWith = (status: number, body: unknown) => async () => ({ status, json: async () => body });

	it('resolves the check next to the configured function route', () => {
		assert.strictEqual(
			cbosHealthUrl('http://localhost:7071/api/consultee-areas'),
			'http://localhost:7071/api/cbos/health'
		);
	});

	it('renders the page without running the check', async () => {
		const res = newRes();
		await buildCbosConnectionPage()({}, res);

		assert.strictEqual(res.render.mock.calls[0].arguments[0], 'views/admin-cbos-connection/view.njk');
		assert.strictEqual(viewModel(res).database, undefined);
	});

	it('shows each part of a successful check, sending the API key', async (t) => {
		const body = {
			status: 'OK',
			database: { status: 'OK', detail: 'connected to back-office' },
			storage: { status: 'OK', detail: 'listed 5 blob name(s) in document-service-uploads' }
		};
		const fetchMock = t.mock.method(globalThis, 'fetch', respondWith(200, body));
		const res = newRes();
		await buildRunCbosConnectionCheck(newService())({}, res);

		assert.strictEqual(fetchMock.mock.calls[0].arguments[0], 'http://localhost:7071/api/cbos/health');
		assert.strictEqual(fetchMock.mock.calls[0].arguments[1].headers['x-api-key'], 'test-function-api-key');
		assert.deepStrictEqual(viewModel(res).database, body.database);
		assert.deepStrictEqual(viewModel(res).storage, body.storage);
		assert.strictEqual(viewModel(res).error, undefined);
	});

	it('shows a failed part from a 503 alongside the part that worked', async (t) => {
		const body = {
			status: 'ERROR',
			database: { status: 'ERROR', detail: 'OperationalError: Login failed' },
			storage: { status: 'OK', detail: 'listed 5 blob name(s)' }
		};
		t.mock.method(globalThis, 'fetch', respondWith(503, body));
		const res = newRes();
		await buildRunCbosConnectionCheck(newService())({}, res);

		assert.deepStrictEqual(viewModel(res).database, body.database);
		assert.match(res.render.mock.calls[0].result, /Failed/);
		assert.match(res.render.mock.calls[0].result, /OperationalError: Login failed/);
	});

	it("shows the function's own error when it couldn't run the check", async (t) => {
		t.mock.method(
			globalThis,
			'fetch',
			respondWith(500, { status: 'ERROR', error: 'missing settings: IDAS_BACK_OFFICE_DATABASE_SERVER' })
		);
		const res = newRes();
		await buildRunCbosConnectionCheck(newService())({}, res);

		assert.strictEqual(
			viewModel(res).error,
			'The Python function could not run the check (status 500): missing settings: IDAS_BACK_OFFICE_DATABASE_SERVER'
		);
	});

	it('shows the status when the response has no usable body', async (t) => {
		t.mock.method(globalThis, 'fetch', async () => ({
			status: 404,
			json: async () => {
				throw new SyntaxError('not JSON');
			}
		}));
		const res = newRes();
		await buildRunCbosConnectionCheck({ ...newService(), pythonFunctionApiKey: undefined })({}, res);

		assert.strictEqual(viewModel(res).error, 'The Python function could not run the check (status 404).');
	});

	it('shows an error when the function is unreachable', async (t) => {
		t.mock.method(globalThis, 'fetch', async () => {
			throw new Error('network error');
		});
		const res = newRes();
		await buildRunCbosConnectionCheck(newService())({}, res);

		assert.strictEqual(viewModel(res).error, 'Could not reach the Python function.');
	});

	it('shows an error without calling fetch when PYTHON_FUNCTION_URL is not configured', async (t) => {
		const fetchMock = t.mock.method(globalThis, 'fetch', respondWith(200, {}));
		const res = newRes();
		await buildRunCbosConnectionCheck({ ...newService(), pythonFunctionUrl: undefined })({}, res);

		assert.strictEqual(fetchMock.mock.callCount(), 0);
		assert.strictEqual(viewModel(res).error, 'Could not reach the Python function: it is not configured.');
	});
});
