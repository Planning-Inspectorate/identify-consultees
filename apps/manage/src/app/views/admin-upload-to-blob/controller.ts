import type { ManageService } from '#service';
import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { unlink } from 'node:fs/promises';
import type { UploadToBlobViewModel } from './view-model.ts';

const VIEW = 'views/admin-upload-to-blob/view.njk';
const PAGE_HEADING = 'Upload a file to blob storage';

export type BlobStoreConfig = { host: string; container: string };
export type BlobUploader = (filePath: string, blobName: string, blobStoreConfig: BlobStoreConfig) => Promise<void>;

/** Real implementation - Entra/managed-identity auth only, no connection string/key (see config.ts). */
export async function uploadFileToBlob(
	filePath: string,
	blobName: string,
	blobStoreConfig: BlobStoreConfig
): Promise<void> {
	const blobServiceClient = new BlobServiceClient(blobStoreConfig.host, new DefaultAzureCredential());
	const containerClient = blobServiceClient.getContainerClient(blobStoreConfig.container);
	const blockBlobClient = containerClient.getBlockBlobClient(blobName);
	await blockBlobClient.uploadFile(filePath);
}

export function buildUploadToBlobPage(): AsyncRequestHandler {
	return async (req, res) => {
		const viewModel: UploadToBlobViewModel = { pageHeading: PAGE_HEADING };
		return res.render(VIEW, viewModel);
	};
}

/** `req.file` is populated by multer middleware applied at the route level - see index.ts. */
export function buildRunUploadToBlob(
	service: ManageService,
	uploadFile: BlobUploader = uploadFileToBlob
): AsyncRequestHandler {
	const { logger, blobStoreConfig } = service;

	return async (req, res) => {
		const viewModel: UploadToBlobViewModel = { pageHeading: PAGE_HEADING };
		const file = req.file;

		if (!blobStoreConfig) {
			viewModel.error = 'Blob storage is not configured for this environment.';
			return res.render(VIEW, viewModel);
		}
		if (!file) {
			viewModel.error = 'Select a file to upload (up to 250MB).';
			return res.render(VIEW, viewModel);
		}

		try {
			await uploadFile(file.path, file.originalname, blobStoreConfig);
			viewModel.uploadedBlobName = file.originalname;
		} catch (error) {
			logger.error({ error }, 'Failed to upload file to blob storage');
			viewModel.error = 'Could not upload the file to blob storage.';
		} finally {
			await unlink(file.path).catch(() => {});
		}

		return res.render(VIEW, viewModel);
	};
}
