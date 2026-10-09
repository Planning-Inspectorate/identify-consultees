import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../nunjucks.ts';
import {
	buildImportReferenceDataPage,
	buildRunImportCaseBoundaries,
	buildRunImportConsulteeAreas,
	CASE_BOUNDARIES_BLOB_NAME,
	CONSULTEE_AREAS_BLOB_NAME
} from './controller.ts';

describe('admin import reference data', () => {
	const nunjucks = configureNunjucks();
	const newRes = () => ({ render: mock.fn((view, data) => nunjucks.render(view, data)) });
	const newDownload = (filePath = '/tmp/does-not-exist-import-reference-data-test') =>
		mock.fn(async () => ({ filePath, cleanup: mock.fn(async () => undefined) }));

	const countingDb = (consulteeAreas = 18_258, caseBoundaries = 283) => ({
		$queryRaw: mock.fn(async () => [{ consulteeAreas, caseBoundaries }])
	});

	it('renders the page with no prior result, and the rows currently loaded', async () => {
		const res = newRes();
		const page = buildImportReferenceDataPage({ db: countingDb(), logger: mockLogger() });
		await page({}, res);
		assert.strictEqual(res.render.mock.callCount(), 1);
		assert.strictEqual(res.render.mock.calls[0].arguments[0], 'views/admin-import-reference-data/view.njk');
		const viewModel = res.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.consulteeAreasImported, undefined);
		assert.strictEqual(viewModel.caseBoundariesImported, undefined);
		assert.strictEqual(viewModel.loadedConsulteeAreas, 18_258);
		assert.strictEqual(viewModel.loadedCaseBoundaries, 283);
		const html = res.render.mock.calls[0].result;
		assert.match(html, /Currently loaded/);
		assert.match(html, /deletes every existing row/);
		assert.match(html, /Replace consultee areas/);
	});

	it('still renders the page, without counts, if counting fails', async () => {
		const res = newRes();
		const logger = mockLogger();
		const db = {
			$queryRaw: mock.fn(async () => {
				throw new Error('database unavailable');
			})
		};
		await buildImportReferenceDataPage({ db, logger })({}, res);

		const viewModel = res.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.loadedConsulteeAreas, undefined);
		assert.doesNotMatch(res.render.mock.calls[0].result, /Currently loaded/);
		assert.strictEqual(logger.warn.mock.callCount(), 1);
	});

	describe('buildRunImportConsulteeAreas', () => {
		it('downloads the known blob and reports the imported count on success', async () => {
			const res = newRes();
			const download = newDownload('/tmp/consultee-areas.geojson');
			const runImport = mock.fn(async () => 18258);
			const logger = mockLogger();
			const run = buildRunImportConsulteeAreas({ db: countingDb(), logger }, download, runImport);
			await run({}, res);

			assert.strictEqual(download.mock.calls[0].arguments[0], CONSULTEE_AREAS_BLOB_NAME);
			assert.strictEqual(runImport.mock.calls[0].arguments[1], '/tmp/consultee-areas.geojson');
			// replaces the table rather than merging into it
			assert.deepStrictEqual(runImport.mock.calls[0].arguments[2], { replace: true });

			const { error, consulteeAreasImported, loadedConsulteeAreas } = res.render.mock.calls[0].arguments[1];
			assert.strictEqual(error, undefined);
			assert.strictEqual(consulteeAreasImported, 18258);
			assert.strictEqual(loadedConsulteeAreas, 18_258);
			assert.match(res.render.mock.calls[0].result, /Replaced consultee areas: imported 18258/);

			// a replace-import wipes and reloads the table - the audit line must say who ran it
			const [fields, message] = logger.info.mock.calls[0].arguments;
			assert.strictEqual(fields.blobName, CONSULTEE_AREAS_BLOB_NAME);
			assert.strictEqual(fields.imported, 18258);
			assert.strictEqual(fields.username, 'unknown');
			assert.match(message, /replaced consultee areas/);
		});

		it('renders an error when the download fails, without throwing', async () => {
			const res = newRes();
			const download = mock.fn(async () => {
				throw new Error('AuthorizationPermissionMismatch');
			});
			const runImport = mock.fn(async () => 0);
			const run = buildRunImportConsulteeAreas({ db: {}, logger: mockLogger() }, download, runImport);
			await run({}, res);

			assert.strictEqual(runImport.mock.callCount(), 0);
			const { error, consulteeAreasImported } = res.render.mock.calls[0].arguments[1];
			assert.match(error, /Could not import consultee areas/);
			assert.strictEqual(consulteeAreasImported, undefined);
		});

		it('renders an error when the import itself fails, without throwing', async () => {
			const res = newRes();
			const download = newDownload();
			const runImport = mock.fn(async () => {
				throw new Error('bad geometry');
			});
			const run = buildRunImportConsulteeAreas({ db: {}, logger: mockLogger() }, download, runImport);
			await run({}, res);

			const { error, consulteeAreasImported } = res.render.mock.calls[0].arguments[1];
			assert.match(error, /Could not import consultee areas/);
			assert.strictEqual(consulteeAreasImported, undefined);
		});
	});

	describe('buildRunImportCaseBoundaries', () => {
		it('downloads the known blob and reports the imported count on success', async () => {
			const res = newRes();
			const download = newDownload('/tmp/case-boundaries.geojson');
			const runImport = mock.fn(async () => 433);
			const logger = mockLogger();
			const run = buildRunImportCaseBoundaries({ db: {}, logger }, download, runImport);
			await run({}, res);

			assert.strictEqual(download.mock.calls[0].arguments[0], CASE_BOUNDARIES_BLOB_NAME);
			assert.deepStrictEqual(runImport.mock.calls[0].arguments[2], { replace: true });
			assert.strictEqual(runImport.mock.calls[0].arguments[1], '/tmp/case-boundaries.geojson');

			const { error, caseBoundariesImported } = res.render.mock.calls[0].arguments[1];
			assert.strictEqual(error, undefined);
			assert.strictEqual(caseBoundariesImported, 433);

			const [fields, message] = logger.info.mock.calls[0].arguments;
			assert.strictEqual(fields.blobName, CASE_BOUNDARIES_BLOB_NAME);
			assert.strictEqual(fields.imported, 433);
			assert.match(message, /replaced case boundaries/);
		});

		it('renders an error when the download fails, without throwing', async () => {
			const res = newRes();
			const download = mock.fn(async () => {
				throw new Error('AuthorizationPermissionMismatch');
			});
			const runImport = mock.fn(async () => 0);
			const run = buildRunImportCaseBoundaries({ db: {}, logger: mockLogger() }, download, runImport);
			await run({}, res);

			assert.strictEqual(runImport.mock.callCount(), 0);
			const { error, caseBoundariesImported } = res.render.mock.calls[0].arguments[1];
			assert.match(error, /Could not import case boundaries/);
			assert.strictEqual(caseBoundariesImported, undefined);
		});
	});
});
