import type { ManageService } from '#service';
import { DefaultAzureCredential } from '@azure/identity';
import type { ContainerClient } from '@azure/storage-blob';
import { BlobServiceClient } from '@azure/storage-blob';
import {
	dateFromFileName,
	groupBlobName,
	isoDate
} from '@pins/identify-consultees-database/src/seed/consultee-area-groups.ts';
import { groupBySlug, REFERENCE_DATA_CONFIG } from '@pins/identify-consultees-database/src/seed/reference-data.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { unlink } from 'node:fs/promises';
import type { UploadToBlobViewModel } from './view-model.ts';

const VIEW = 'admin/upload-to-blob/view.njk';
const PAGE_HEADING = 'Upload a file to blob storage';

export type BlobStoreConfig = { host: string; container: string };
export type BlobUploader = (filePath: string, blobName: string, blobStoreConfig: BlobStoreConfig) => Promise<void>;

// large reference data exports (the full combined reference data is over 500MB) are the
// motivating use case - see packages/database/src/seed/import-from-blob.ts - but this isn't
// restricted to one file type.
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

/**
 * The size of each part the page's script sends a file in (public/javascripts/blob-upload.js).
 * One request carrying a whole export - through Front Door, onto the app's disk, then on to blob
 * storage - can outlast Front Door's response timeout; parts this size each take seconds.
 */
export const CHUNK_BYTES = 8 * 1024 * 1024;

/** The most parts a file of up to MAX_UPLOAD_BYTES is sent in. */
export const MAX_BLOCKS = Math.ceil(MAX_UPLOAD_BYTES / CHUNK_BYTES);

// a file's own name, as the blob's - letters, digits and . _ - ( ) or spaces, nothing that could
// read as a path
const BLOB_NAME = /^[\w(][\w .()-]{0,199}$/;

/** Whether `name` can name an uploaded blob. */
export function isBlobName(name: unknown): name is string {
	return typeof name === 'string' && BLOB_NAME.test(name);
}

/**
 * A part's block id: the same length for every part of a blob, as Azure requires, and in order.
 * Staging a part again under the same id replaces it, so a retried part can't be counted twice.
 */
export function blockId(index: number): string {
	return Buffer.from(`block-${String(index).padStart(6, '0')}`).toString('base64');
}

/** Writes a blob a part at a time: each part staged as a block, then the blocks committed in order. */
export interface BlockUploads {
	stage(blobName: string, index: number, data: Buffer): Promise<void>;
	/** Make the blob the first `blockCount` staged parts, in order - replacing any blob of that name. */
	commit(blobName: string, blockCount: number): Promise<void>;
}

// one client per container, kept: a file goes up in as many as MAX_BLOCKS requests, and a new
// credential for each would sign in again for each part
const containers = new Map<string, ContainerClient>();

/** The app's blob container - Entra/managed-identity auth only, no connection string/key (see config.ts). */
function containerClient({ host, container }: BlobStoreConfig): ContainerClient {
	const key = `${host}\n${container}`;
	let client = containers.get(key);
	if (!client) {
		client = new BlobServiceClient(host, new DefaultAzureCredential()).getContainerClient(container);
		containers.set(key, client);
	}
	return client;
}

/** Real implementation, on the app's blob container. */
export function blobBlockUploads(blobStoreConfig: BlobStoreConfig): BlockUploads {
	const container = containerClient(blobStoreConfig);
	return {
		async stage(blobName, index, data) {
			await container.getBlockBlobClient(blobName).stageBlock(blockId(index), data, data.length);
		},
		async commit(blobName, blockCount) {
			const blocks = Array.from({ length: blockCount }, (_, index) => blockId(index));
			await container.getBlockBlobClient(blobName).commitBlockList(blocks);
		}
	};
}

/** Real implementation, on the app's blob container. */
export async function uploadFileToBlob(
	filePath: string,
	blobName: string,
	blobStoreConfig: BlobStoreConfig
): Promise<void> {
	await containerClient(blobStoreConfig).getBlockBlobClient(blobName).uploadFile(filePath);
}

/**
 * The page. `?uploaded=<name>` - where the script goes once a file's parts are committed - shows
 * that it was uploaded.
 */
export function buildUploadToBlobPage(): AsyncRequestHandler {
	return async (req, res) => {
		const uploaded = req.query?.uploaded;
		const viewModel: UploadToBlobViewModel = {
			...pageViewModel(),
			...(isBlobName(uploaded) ? { uploadedBlobName: uploaded } : {})
		};
		return res.render(VIEW, viewModel);
	};
}

/** What every render of the page needs: the groups to upload a file for, and the part size. */
function pageViewModel(): UploadToBlobViewModel {
	return {
		pageHeading: PAGE_HEADING,
		chunkBytes: CHUNK_BYTES,
		maxUploadBytes: MAX_UPLOAD_BYTES,
		groups: REFERENCE_DATA_CONFIG.groups.map((group) => ({
			name: group.name,
			slug: group.slug,
			categories: [...group.categories].join(', ')
		}))
	};
}

/**
 * The name a posted file is saved under: a group's, from the date its data is from - the form's
 * date, else the date the file's name starts with - as in 20261020_public_bodies.geojson; else
 * the file's own name.
 */
export function uploadBlobName(
	body: Record<string, unknown> | undefined,
	originalName: string
): { name: string } | { error: string } {
	if (!body?.group) {
		return { name: originalName };
	}
	const group = groupBySlug(body.group);
	if (!group) {
		return { error: 'Choose the group the file is for.' };
	}
	const typed = [body['date-day'], body['date-month'], body['date-year']];
	const dataDate = typed.every((part) => String(part ?? '').trim() === '')
		? dateFromFileName(originalName)
		: isoDate(typed[0], typed[1], typed[2]);
	if (!dataDate) {
		return { error: `Enter the date the ${group.name} data is from, as a real date.` };
	}
	return { name: groupBlobName(group, dataDate) };
}

type UploadsFor = (blobStoreConfig: BlobStoreConfig) => BlockUploads;

/**
 * One part of a file the page's script is uploading: `?name=<blob>&block=<n>`, the part's bytes as
 * the body (application/octet-stream - see index.ts). Answers 204, or an error as JSON.
 */
export function buildStageBlock(
	service: ManageService,
	uploadsFor: UploadsFor = blobBlockUploads
): AsyncRequestHandler {
	const { logger, blobStoreConfig } = service;

	return async (req, res) => {
		if (!blobStoreConfig) {
			res.status(503).json({ error: 'Blob storage is not configured for this environment.' });
			return;
		}
		const name = req.query.name;
		const block = Number(req.query.block);
		const data = req.body;
		if (!isBlobName(name) || !Number.isInteger(block) || block < 0 || block >= MAX_BLOCKS) {
			res.status(400).json({ error: 'The upload named a file or part that can not be uploaded.' });
			return;
		}
		if (!Buffer.isBuffer(data) || data.length === 0) {
			res.status(400).json({ error: 'The upload sent an empty part.' });
			return;
		}
		try {
			await uploadsFor(blobStoreConfig).stage(name, block, data);
		} catch (error) {
			logger.error({ error, name, block }, 'Failed to stage an upload part in blob storage');
			res.status(502).json({ error: 'Could not upload the file to blob storage.' });
			return;
		}
		res.status(204).end();
	};
}

/**
 * Finish a file the page's script uploaded in parts: `{ name, blocks }`, the blob and how many
 * parts it was sent in. Answers the blob's name, or an error, as JSON.
 */
export function buildCommitBlocks(
	service: ManageService,
	uploadsFor: UploadsFor = blobBlockUploads
): AsyncRequestHandler {
	const { logger, blobStoreConfig } = service;

	return async (req, res) => {
		if (!blobStoreConfig) {
			res.status(503).json({ error: 'Blob storage is not configured for this environment.' });
			return;
		}
		const { name, blocks } = (req.body ?? {}) as { name?: unknown; blocks?: unknown };
		if (!isBlobName(name) || !Number.isInteger(blocks) || (blocks as number) < 1 || (blocks as number) > MAX_BLOCKS) {
			res.status(400).json({ error: 'The upload named a file or part that can not be uploaded.' });
			return;
		}
		try {
			await uploadsFor(blobStoreConfig).commit(name, blocks as number);
		} catch (error) {
			logger.error({ error, name, blocks }, 'Failed to commit an upload in blob storage');
			res.status(502).json({ error: 'Could not upload the file to blob storage.' });
			return;
		}
		logger.info({ name, blocks }, 'uploaded a file to blob storage in parts');
		res.json({ uploadedBlobName: name });
	};
}

/** `req.file` is populated by multer middleware applied at the route level - see index.ts. */
export function buildRunUploadToBlob(
	service: ManageService,
	uploadFile: BlobUploader = uploadFileToBlob
): AsyncRequestHandler {
	const { logger, blobStoreConfig } = service;

	return async (req, res) => {
		const viewModel: UploadToBlobViewModel = pageViewModel();
		const file = req.file;

		if (!blobStoreConfig) {
			viewModel.error = 'Blob storage is not configured for this environment.';
			return res.render(VIEW, viewModel);
		}
		if (!file) {
			viewModel.error = 'Select a file to upload (up to 1GB).';
			return res.render(VIEW, viewModel);
		}

		const target = uploadBlobName(req.body as Record<string, unknown> | undefined, file.originalname);
		if ('error' in target) {
			viewModel.error = target.error;
			await unlink(file.path).catch(() => {});
			return res.render(VIEW, viewModel);
		}
		try {
			await uploadFile(file.path, target.name, blobStoreConfig);
			viewModel.uploadedBlobName = target.name;
		} catch (error) {
			logger.error({ error }, 'Failed to upload file to blob storage');
			viewModel.error = 'Could not upload the file to blob storage.';
		} finally {
			await unlink(file.path).catch(() => {});
		}

		return res.render(VIEW, viewModel);
	};
}
