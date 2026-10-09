import { BlockBlobClient } from '@azure/storage-blob';
import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../nunjucks.ts';
import {
	buildRunUploadToBlob,
	buildUploadToBlobPage,
	removeTempUpload,
	safeBlobName,
	uploadFileToBlob
} from './controller.ts';

describe('admin upload to blob', () => {
	const nunjucks = configureNunjucks();
	const newRes = () => ({ render: mock.fn((view, data) => nunjucks.render(view, data)) });
	const blobStoreConfig = { host: 'https://example.blob.core.windows.net/', container: 'consultees-data' };
	const newFile = () => ({
		path: join(tmpdir(), 'does-not-exist-upload-to-blob-test'),
		originalname: 'reference-data.geojson'
	});

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

	it('audit-logs the actor and blob name on a successful upload', async () => {
		const res = newRes();
		const file = newFile();
		const logger = mockLogger();
		const run = buildRunUploadToBlob(
			{ logger, blobStoreConfig },
			mock.fn(async () => undefined)
		);
		await run(
			{
				file,
				session: { account: { username: 'admin@planninginspectorate.gov.uk', localAccountId: 'oid-1' } }
			},
			res
		);

		assert.strictEqual(logger.info.mock.callCount(), 1);
		const [fields, message] = logger.info.mock.calls[0].arguments;
		assert.strictEqual(fields.blobName, file.originalname);
		assert.strictEqual(fields.username, 'admin@planninginspectorate.gov.uk');
		assert.strictEqual(fields.userId, 'oid-1');
		assert.match(message, /uploaded file to blob storage/);
	});

	// the filename becomes the blob name verbatim, so traversal-style names must never
	// reach storage - a crafted name is how reference data gets overwritten out of band
	for (const fileName of [
		'../combined_reference_data_v1.geojson',
		'nested/combined_reference_data_v1.geojson',
		'back\\slash.geojson',
		'has space.geojson',
		'.hidden.geojson',
		'x'.repeat(201) + '.geojson',
		''
	]) {
		it(`rejects the unsafe filename "${fileName.slice(0, 40)}" without uploading`, async () => {
			const res = newRes();
			const logger = mockLogger();
			const uploadFile = mock.fn(async () => undefined);
			const run = buildRunUploadToBlob({ logger, blobStoreConfig }, uploadFile);
			await run({ file: { ...newFile(), originalname: fileName } }, res);

			assert.strictEqual(uploadFile.mock.callCount(), 0);
			const { error, uploadedBlobName } = res.render.mock.calls[0].arguments[1];
			assert.match(error, /letters, numbers, dots, hyphens and underscores/);
			assert.strictEqual(uploadedBlobName, undefined);
			assert.strictEqual(logger.warn.mock.callCount(), 1);
		});
	}

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

	it('rejects a multer temp path outside the configured temp dir without uploading', async () => {
		// req.file fields are user-influenced - a path outside os.tmpdir() must never reach
		// the read or delete side (the finally's removeTempUpload no-ops on it either)
		const res = newRes();
		const logger = mockLogger();
		const uploadFile = mock.fn(async () => undefined);
		const run = buildRunUploadToBlob({ logger, blobStoreConfig }, uploadFile);
		await run(
			{
				file: {
					path: join(dirname(tmpdir()), 'not-the-upload-dir', 'escape.geojson'),
					originalname: 'escape.geojson'
				}
			},
			res
		);

		assert.strictEqual(uploadFile.mock.callCount(), 0);
		const { error, uploadedBlobName } = res.render.mock.calls[0].arguments[1];
		assert.match(error, /Could not upload/);
		assert.strictEqual(uploadedBlobName, undefined);
		assert.strictEqual(logger.warn.mock.callCount(), 1);
	});

	describe('removeTempUpload', () => {
		it('ignores missing and out-of-tmpdir paths', async () => {
			await assert.doesNotReject(() => removeTempUpload(undefined));
			await assert.doesNotReject(() =>
				removeTempUpload(join(dirname(tmpdir()), 'not-the-upload-dir', 'escape.geojson'))
			);
		});
	});

	describe('safeBlobName', () => {
		for (const [fileName, expected] of [
			['combined_reference_data_v1.geojson', 'combined_reference_data_v1.geojson'],
			['all-project-boundaries.geojson', 'all-project-boundaries.geojson'],
			['UPPERCASE_123.JSON', 'UPPERCASE_123.JSON'],
			['a', 'a'],
			['..', undefined],
			['file..geojson', undefined],
			['C:\\temp\\file.geojson', undefined],
			['/abs/path.geojson', undefined],
			['semi;colon.geojson', undefined],
			['trailing-', undefined],
			[undefined, undefined]
		] as const) {
			it(`${JSON.stringify(fileName)} -> ${JSON.stringify(expected)}`, () => {
				assert.strictEqual(safeBlobName(fileName), expected);
			});
		}
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
