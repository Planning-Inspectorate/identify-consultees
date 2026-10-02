import { BlockBlobClient } from '@azure/storage-blob';
import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../nunjucks.ts';
import { buildRunUploadToBlob, buildUploadToBlobPage, uploadFileToBlob } from './controller.ts';

describe('admin upload to blob', () => {
	const nunjucks = configureNunjucks();
	const newRes = () => ({ render: mock.fn((view, data) => nunjucks.render(view, data)) });
	const blobStoreConfig = { host: 'https://example.blob.core.windows.net/', container: 'consultees-data' };
	const newFile = () => ({ path: '/tmp/does-not-exist-upload-to-blob-test', originalname: 'reference-data.geojson' });

	it('renders the page with no prior result', async () => {
		const res = newRes();
		const page = buildUploadToBlobPage();
		await page({}, res);
		assert.strictEqual(res.render.mock.callCount(), 1);
		assert.strictEqual(res.render.mock.calls[0].arguments[0], 'views/admin-upload-to-blob/view.njk');
		assert.strictEqual(res.render.mock.calls[0].arguments[1].uploadedBlobName, undefined);
	});

	it('shows an error when blob storage is not configured', async () => {
		const res = newRes();
		const run = buildRunUploadToBlob({ logger: mockLogger(), blobStoreConfig: undefined });
		await run({ file: newFile() }, res);

		const { error, uploadedBlobName } = res.render.mock.calls[0].arguments[1];
		assert.match(error, /not configured/);
		assert.strictEqual(uploadedBlobName, undefined);
	});

	it('shows an error when no file was selected', async () => {
		const res = newRes();
		const run = buildRunUploadToBlob({ logger: mockLogger(), blobStoreConfig });
		await run({ file: undefined }, res);

		const { error, uploadedBlobName } = res.render.mock.calls[0].arguments[1];
		assert.match(error, /Select a file/);
		assert.strictEqual(uploadedBlobName, undefined);
	});

	it('uploads the file and reports the blob name on success', async () => {
		const res = newRes();
		const file = newFile();
		const uploadFile = mock.fn(async () => undefined);
		const run = buildRunUploadToBlob({ logger: mockLogger(), blobStoreConfig }, uploadFile);
		await run({ file }, res);

		assert.strictEqual(uploadFile.mock.callCount(), 1);
		assert.deepStrictEqual(uploadFile.mock.calls[0].arguments, [file.path, file.originalname, blobStoreConfig]);

		const { error, uploadedBlobName } = res.render.mock.calls[0].arguments[1];
		assert.strictEqual(error, undefined);
		assert.strictEqual(uploadedBlobName, file.originalname);
	});

	it('renders an error when the upload fails, without throwing', async () => {
		const res = newRes();
		const uploadFile = mock.fn(async () => {
			throw new Error('network error');
		});
		const run = buildRunUploadToBlob({ logger: mockLogger(), blobStoreConfig }, uploadFile);
		await run({ file: newFile() }, res);

		const { error, uploadedBlobName } = res.render.mock.calls[0].arguments[1];
		assert.match(error, /Could not upload/);
		assert.strictEqual(uploadedBlobName, undefined);
	});

	describe('uploadFileToBlob', () => {
		it('rejects rather than hanging against an unreachable host (no real storage account in tests)', async () => {
			await assert.rejects(() =>
				uploadFileToBlob('/tmp/does-not-exist-upload-to-blob-test', 'test.geojson', {
					host: 'https://does-not-exist.invalid/',
					container: 'consultees-data'
				})
			);
		});

		it('resolves when the underlying SDK call succeeds', async (t) => {
			t.mock.method(BlockBlobClient.prototype, 'uploadFile', async () => undefined);
			await assert.doesNotReject(() =>
				uploadFileToBlob('/tmp/does-not-exist-upload-to-blob-test', 'test.geojson', {
					host: 'https://example.blob.core.windows.net/',
					container: 'consultees-data'
				})
			);
		});
	});
});
