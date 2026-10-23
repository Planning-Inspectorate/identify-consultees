import { BlobServiceClient, BlockBlobClient } from '@azure/storage-blob';
import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../nunjucks.ts';
import {
	blobBlockUploads,
	blockId,
	buildCommitBlocks,
	buildRunUploadToBlob,
	buildStageBlock,
	buildUploadToBlobPage,
	CHUNK_BYTES,
	isBlobName,
	MAX_BLOCKS,
	uploadBlobName,
	uploadFileToBlob
} from './controller.ts';

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
		assert.strictEqual(res.render.mock.calls[0].arguments[0], 'admin/upload-to-blob/view.njk');
		assert.strictEqual(res.render.mock.calls[0].arguments[1].uploadedBlobName, undefined);
		// the script sends the file in parts this size
		const html = res.render.mock.calls[0].result as string;
		assert.match(html, new RegExp(`data-chunked-upload data-chunk-bytes="${CHUNK_BYTES}"`));
		assert.match(html, /data-upload-status/);
	});

	it('says which file was uploaded when the script lands back on the page, ignoring any other name', async () => {
		const page = buildUploadToBlobPage();
		const res = newRes();
		await page({ query: { uploaded: '20261020_combined_reference_data (1).geojson' } }, res);
		assert.strictEqual(
			res.render.mock.calls[0].arguments[1].uploadedBlobName,
			'20261020_combined_reference_data (1).geojson'
		);
		assert.match(
			res.render.mock.calls[0].result as string,
			/Uploaded &quot;20261020_combined_reference_data \(1\)\.geojson&quot;/
		);

		const odd = newRes();
		await page({ query: { uploaded: '../secrets' } }, odd);
		assert.strictEqual(odd.render.mock.calls[0].arguments[1].uploadedBlobName, undefined);
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

	it("has a form for each group of the reference data, with the date it's from, and one for any other file", async () => {
		const res = newRes();
		await buildUploadToBlobPage()({}, res);
		const html = res.render.mock.calls[0].result as string;
		for (const slug of ['administrative_boundaries', 'public_bodies', 'energy', 'transport', 'other']) {
			assert.match(html, new RegExp(`data-blob-group="${slug}"`));
			assert.match(html, new RegExp(`id="date-${slug}-day"`));
		}
		assert.match(html, />\s*Upload Public bodies\s*</);
		assert.match(html, /Another file/);
		assert.equal((res.render.mock.calls[0].arguments[1] as { groups: unknown[] }).groups.length, 5);
	});

	it("saves a group's file as the group's for its date - the form's, else its name's", () => {
		assert.deepStrictEqual(uploadBlobName(undefined, 'all-project-boundaries.geojson'), {
			name: 'all-project-boundaries.geojson'
		});
		assert.deepStrictEqual(uploadBlobName({ group: '' }, 'a.geojson'), { name: 'a.geojson' });
		assert.deepStrictEqual(
			uploadBlobName({ group: 'energy', 'date-day': '20', 'date-month': '10', 'date-year': '2026' }, 'energy.geojson'),
			{ name: '20261020_energy.geojson' }
		);
		assert.deepStrictEqual(
			uploadBlobName(
				{ group: 'energy', 'date-day': '', 'date-month': ' ', 'date-year': '' },
				'20261020_combined.geojson'
			),
			{ name: '20261020_energy.geojson' }
		);
		assert.deepStrictEqual(uploadBlobName({ group: 'energy' }, 'energy.geojson'), {
			error: 'Enter the date the Energy data is from, as a real date.'
		});
		assert.deepStrictEqual(
			uploadBlobName({ group: 'energy', 'date-day': '31', 'date-month': '2', 'date-year': '2026' }, 'e.geojson'),
			{ error: 'Enter the date the Energy data is from, as a real date.' }
		);
		assert.deepStrictEqual(uploadBlobName({ group: 'nope' }, 'e.geojson'), {
			error: 'Choose the group the file is for.'
		});
	});

	it("uploads a group's file under its group name, and refuses one without a date - removing the temp file", async () => {
		const uploadFile = mock.fn(async () => undefined);
		const run = buildRunUploadToBlob({ logger: mockLogger(), blobStoreConfig }, uploadFile);
		const named = newRes();
		await run(
			{ file: { ...newFile(), originalname: '20261020_energy_full.geojson' }, body: { group: 'energy' } },
			named
		);
		assert.strictEqual(uploadFile.mock.calls[0].arguments[1], '20261020_energy.geojson');
		assert.strictEqual(named.render.mock.calls[0].arguments[1].uploadedBlobName, '20261020_energy.geojson');

		const undated = newRes();
		await run({ file: newFile(), body: { group: 'energy' } }, undated);
		assert.strictEqual(uploadFile.mock.callCount(), 1);
		assert.match(undated.render.mock.calls[0].arguments[1].error, /Enter the date the Energy data is from/);
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

	describe('uploading in parts', () => {
		const jsonRes = () => {
			const res = {
				status: mock.fn(() => res),
				json: mock.fn(),
				end: mock.fn()
			};
			return res;
		};
		const fakeUploads = () => {
			const uploads = { stage: mock.fn(async () => undefined), commit: mock.fn(async () => undefined) };
			return { uploads, uploadsFor: mock.fn(() => uploads) };
		};
		const service = { logger: mockLogger(), blobStoreConfig } as never;
		const part = Buffer.from('{"type":"FeatureCollection"');

		it('names blobs by a file name, never a path', () => {
			for (const name of ['combined_reference_data_v1.geojson', '20261020_combined_reference_data (1).geojson', 'a']) {
				assert.ok(isBlobName(name), name);
			}
			for (const name of ['', '../x.geojson', 'a/b', ' leading-space', '.hidden', 'x'.repeat(201), 5, undefined]) {
				assert.ok(!isBlobName(name), String(name));
			}
		});

		it('gives every part an id of the same length, in order', () => {
			assert.equal(Buffer.from(blockId(7), 'base64').toString(), 'block-000007');
			assert.equal(blockId(0).length, blockId(MAX_BLOCKS - 1).length);
			// a 1GB file in 8MB parts
			assert.equal(MAX_BLOCKS, 128);
		});

		it('stages a part as a block of the blob', async () => {
			const { uploads, uploadsFor } = fakeUploads();
			const res = jsonRes();
			await buildStageBlock(service, uploadsFor)(
				{ query: { name: 'data.geojson', block: '3' }, body: part } as never,
				res as never
			);
			assert.deepStrictEqual(uploadsFor.mock.calls[0].arguments, [blobStoreConfig]);
			assert.deepStrictEqual(uploads.stage.mock.calls[0].arguments, ['data.geojson', 3, part]);
			assert.strictEqual(res.status.mock.calls[0].arguments[0], 204);
			assert.strictEqual(res.end.mock.callCount(), 1);
		});

		for (const [title, query, body, message] of [
			['a name that is a path', { name: '../data.geojson', block: '0' }, part, /can not be uploaded/],
			['a part number that is not one', { name: 'data.geojson', block: 'x' }, part, /can not be uploaded/],
			['a negative part', { name: 'data.geojson', block: '-1' }, part, /can not be uploaded/],
			['a part past a 1GB file', { name: 'data.geojson', block: String(MAX_BLOCKS) }, part, /can not be uploaded/],
			['an empty part', { name: 'data.geojson', block: '0' }, Buffer.alloc(0), /empty part/],
			['a part that was not raw bytes', { name: 'data.geojson', block: '0' }, {}, /empty part/]
		] as const) {
			it(`refuses ${title}`, async () => {
				const { uploads, uploadsFor } = fakeUploads();
				const res = jsonRes();
				await buildStageBlock(service, uploadsFor)({ query, body } as never, res as never);
				assert.strictEqual(res.status.mock.calls[0].arguments[0], 400);
				assert.match((res.json.mock.calls[0].arguments[0] as { error: string }).error, message);
				assert.strictEqual(uploads.stage.mock.callCount(), 0);
			});
		}

		it('commits the parts in order, and answers the blob name', async () => {
			const { uploads, uploadsFor } = fakeUploads();
			const res = jsonRes();
			await buildCommitBlocks(service, uploadsFor)(
				{ body: { name: 'data.geojson', blocks: 68 } } as never,
				res as never
			);
			assert.deepStrictEqual(uploads.commit.mock.calls[0].arguments, ['data.geojson', 68]);
			assert.deepStrictEqual(res.json.mock.calls[0].arguments, [{ uploadedBlobName: 'data.geojson' }]);
		});

		for (const [title, body] of [
			['no body', undefined],
			['a name that is a path', { name: 'a/b', blocks: 1 }],
			['no parts', { name: 'data.geojson', blocks: 0 }],
			['more parts than a 1GB file', { name: 'data.geojson', blocks: MAX_BLOCKS + 1 }],
			['a part count that is not a number', { name: 'data.geojson', blocks: '2' }]
		] as const) {
			it(`refuses to commit ${title}`, async () => {
				const { uploads, uploadsFor } = fakeUploads();
				const res = jsonRes();
				await buildCommitBlocks(service, uploadsFor)({ body } as never, res as never);
				assert.strictEqual(res.status.mock.calls[0].arguments[0], 400);
				assert.strictEqual(uploads.commit.mock.callCount(), 0);
			});
		}

		it('says blob storage is not configured, for a part or a commit', async () => {
			const unconfigured = { logger: mockLogger(), blobStoreConfig: undefined } as never;
			for (const handler of [buildStageBlock(unconfigured), buildCommitBlocks(unconfigured)]) {
				const res = jsonRes();
				await handler({ query: {}, body: {} } as never, res as never);
				assert.strictEqual(res.status.mock.calls[0].arguments[0], 503);
				assert.match((res.json.mock.calls[0].arguments[0] as { error: string }).error, /not configured/);
			}
		});

		it('answers 502 when blob storage refuses a part or the commit, and logs why', async () => {
			const failing = {
				stage: mock.fn(async () => {
					throw new Error('network error');
				}),
				commit: mock.fn(async () => {
					throw new Error('network error');
				})
			};
			const logger = mockLogger();
			const failingService = { logger, blobStoreConfig } as never;
			const staged = jsonRes();
			await buildStageBlock(failingService, () => failing)(
				{ query: { name: 'data.geojson', block: '0' }, body: part } as never,
				staged as never
			);
			const committed = jsonRes();
			await buildCommitBlocks(failingService, () => failing)(
				{ body: { name: 'data.geojson', blocks: 1 } } as never,
				committed as never
			);
			for (const res of [staged, committed]) {
				assert.strictEqual(res.status.mock.calls[0].arguments[0], 502);
				assert.match((res.json.mock.calls[0].arguments[0] as { error: string }).error, /Could not upload/);
			}
			assert.strictEqual((logger.error as ReturnType<typeof mock.fn>).mock.callCount(), 2);
		});

		it('stages and commits through the blob SDK, by block id', async (t) => {
			const stageBlock = t.mock.method(BlockBlobClient.prototype, 'stageBlock', async () => ({}));
			const commitBlockList = t.mock.method(BlockBlobClient.prototype, 'commitBlockList', async () => ({}));
			const uploads = blobBlockUploads(blobStoreConfig);
			await uploads.stage('data.geojson', 1, part);
			await uploads.commit('data.geojson', 2);
			assert.deepStrictEqual(stageBlock.mock.calls[0].arguments, [blockId(1), part, part.length]);
			assert.deepStrictEqual(commitBlockList.mock.calls[0].arguments, [[blockId(0), blockId(1)]]);
		});

		it('signs in once per container, not once per part', async (t) => {
			const getContainerClient = t.mock.method(BlobServiceClient.prototype, 'getContainerClient');
			const config = { host: 'https://once.blob.core.windows.net/', container: 'shared' };
			blobBlockUploads(config);
			blobBlockUploads(config);
			blobBlockUploads({ ...config, container: 'other' });
			assert.strictEqual(getContainerClient.mock.callCount(), 2);
		});
	});
});
