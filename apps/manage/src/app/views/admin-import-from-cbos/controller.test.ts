import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../nunjucks.ts';
import { buildImportFromCbosPage, buildRunImportFromCbos } from './controller.ts';

describe('admin import from CBOS', () => {
	const nunjucks = configureNunjucks();
	const newRes = () => ({ render: mock.fn((view, data) => nunjucks.render(view, data)) });
	const newService = (counts: unknown = [{ total: 300, fromCbos: 120 }]) => ({
		logger: mockLogger(),
		db: {
			$queryRaw: mock.fn(async () => {
				if (counts instanceof Error) throw counts;
				return counts;
			})
		},
		pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas',
		pythonFunctionApiKey: 'test-key'
	});
	const viewModel = (res: ReturnType<typeof newRes>) => res.render.mock.calls[0].arguments[1];
	const html = (res: ReturnType<typeof newRes>) => res.render.mock.calls[0].result as string;

	it('shows the loaded counts without importing', async () => {
		const res = newRes();
		await buildImportFromCbosPage(newService() as never)({}, res);

		assert.strictEqual(res.render.mock.calls[0].arguments[0], 'views/admin-import-from-cbos/view.njk');
		assert.strictEqual(viewModel(res).loadedCaseBoundaries, 300);
		assert.strictEqual(viewModel(res).loadedFromCbos, 120);
		assert.strictEqual(viewModel(res).imported, undefined);
	});

	it('leaves the counts off when they cannot be read', async () => {
		const service = newService(new Error('database unavailable'));
		const res = newRes();
		await buildImportFromCbosPage(service as never)({}, res);

		assert.strictEqual(viewModel(res).loadedCaseBoundaries, undefined);
		assert.strictEqual(service.logger.warn.mock.callCount(), 1);
	});

	it('imports through the function and shows what was saved and what was not', async () => {
		const service = newService();
		const runImport = mock.fn(async () => ({
			filesFound: 3,
			imported: 2,
			failures: [{ caseReference: 'EN010001', fileName: 'broken.geojson', reason: 'status 500' }]
		}));
		const res = newRes();
		await buildRunImportFromCbos(service as never, runImport as never)({}, res);

		assert.deepStrictEqual(runImport.mock.calls[0].arguments[1], {
			pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas',
			apiKey: 'test-key'
		});
		assert.match(html(res), /Imported 2 of 3 CBOS boundary files/);
		assert.match(html(res), /broken\.geojson/);
		assert.strictEqual(service.logger.warn.mock.callCount(), 1);
	});

	it('shows success without a failures table when every file imported', async () => {
		const service = newService();
		const runImport = mock.fn(async () => ({ filesFound: 1, imported: 1, failures: [] }));
		const res = newRes();
		await buildRunImportFromCbos(service as never, runImport as never)({}, res);

		assert.doesNotMatch(html(res), /Files not imported/);
		assert.strictEqual(service.logger.warn.mock.callCount(), 0);
	});

	it('shows an error when the import fails', async () => {
		const service = newService();
		const runImport = mock.fn(async () => {
			throw new Error('status 500');
		});
		const res = newRes();
		await buildRunImportFromCbos(service as never, runImport as never)({}, res);

		assert.strictEqual(viewModel(res).error, 'Could not import case boundaries from CBOS.');
		assert.strictEqual(service.logger.error.mock.callCount(), 1);
	});
});
