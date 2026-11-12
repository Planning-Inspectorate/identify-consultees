import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import type { CbosImportResult } from './cbos-boundaries.ts';
import { createCbosCaseRefresh } from './refresh-cases.ts';

const RESULT: CbosImportResult = {
	filesFound: 5,
	unchanged: 2,
	imported: 3,
	casesImported: 2,
	removed: 1,
	failures: []
};

function newService() {
	return {
		db: {} as never,
		logger: mockLogger(),
		pythonFunctionUrl: 'https://function.example/api/consultee-areas',
		pythonFunctionApiKey: 'key'
	};
}

/** An import that finishes when `finish` is called - or fails, with `fail`. */
function controlledImport() {
	let finish: (result: CbosImportResult) => void = () => {};
	let fail: (error: Error) => void = () => {};
	const runImport = mock.fn(
		() =>
			new Promise<CbosImportResult>((resolve, reject) => {
				finish = resolve;
				fail = reject;
			})
	);
	return { runImport, finish: (result = RESULT) => finish(result), fail: (error: Error) => fail(error) };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('refreshing cases from CBOS', () => {
	it("starts an import of every case's new and changed files, without waiting for it", async () => {
		const service = newService();
		const { runImport, finish } = controlledImport();
		const refresh = createCbosCaseRefresh(service, runImport);

		assert.strictEqual(refresh.start(), true);
		assert.strictEqual(runImport.mock.callCount(), 1);
		assert.deepStrictEqual(runImport.mock.calls[0].arguments, [
			service.db,
			{ pythonFunctionUrl: 'https://function.example/api/consultee-areas', apiKey: 'key', onlyNewOrChanged: true }
		]);

		finish();
		await settle();
		const [logged, message] = service.logger.info.mock.calls[0].arguments;
		assert.strictEqual(message, 'Refreshed cases from CBOS');
		assert.deepStrictEqual(logged, { filesFound: 5, unchanged: 2, imported: 3, casesImported: 2, removed: 1 });
		assert.strictEqual(service.logger.warn.mock.callCount(), 0);
	});

	it("doesn't start another while one is running, and does once it's finished", async () => {
		const { runImport, finish } = controlledImport();
		const refresh = createCbosCaseRefresh(newService(), runImport);

		assert.strictEqual(refresh.start(), true);
		assert.strictEqual(refresh.start(), false);
		assert.strictEqual(runImport.mock.callCount(), 1);

		finish();
		await settle();
		assert.strictEqual(refresh.start(), true);
		assert.strictEqual(runImport.mock.callCount(), 2);
	});

	it('logs the files it could not import', async () => {
		const service = newService();
		const { runImport, finish } = controlledImport();
		createCbosCaseRefresh(service, runImport).start();

		const failures = [{ caseReference: 'EN010001', fileName: 'site.geojson', reason: 'unreadable' }];
		finish({ ...RESULT, imported: 2, failures });
		await settle();
		assert.deepStrictEqual(service.logger.warn.mock.calls[0].arguments, [
			{ failures },
			'Some CBOS boundary files could not be imported'
		]);
	});

	it('warns when it removed no boundaries because CBOS stopped listing too many', async () => {
		const service = newService();
		const { runImport, finish } = controlledImport();
		createCbosCaseRefresh(service, runImport).start();

		const removalSkipped =
			'CBOS no longer lists 3 of the 4 boundaries saved from it - more than half, so none were removed';
		finish({ ...RESULT, removed: 0, removalSkipped });
		await settle();
		assert.deepStrictEqual(service.logger.warn.mock.calls[0].arguments, [
			{ reason: removalSkipped },
			'CBOS import removed no boundaries'
		]);
	});

	it('logs a failed import rather than throwing, and can be started again', async () => {
		const service = newService();
		const { runImport, fail } = controlledImport();
		const refresh = createCbosCaseRefresh(service, runImport);
		refresh.start();

		const error = new Error('function unreachable');
		fail(error);
		await settle();
		assert.deepStrictEqual(service.logger.error.mock.calls[0].arguments, [
			{ error },
			'Failed to refresh cases from CBOS'
		]);
		assert.strictEqual(refresh.start(), true);
	});
});
