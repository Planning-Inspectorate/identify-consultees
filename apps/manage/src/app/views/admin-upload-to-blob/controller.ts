import type { ManageService } from '#service';
import { auditActor } from '#util/auth.ts';
import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { UploadToBlobViewModel } from './view-model.ts';

const VIEW = 'views/admin-upload-to-blob/view.njk';
const PAGE_HEADING = 'Upload a file to blob storage';

export type BlobStoreConfig = { host: string; container: string };
export type BlobUploader = (filePath: string, blobName: string, blobStoreConfig: BlobStoreConfig) => Promise<void>;

// uploaded filenames become blob names verbatim - allowlist filename characters so a crafted
// name can't carry path separators or control characters into the container. No '/' means no
// virtual directories, so blobs stay flat alongside the known reference-data files.
const SAFE_BLOB_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,198}[A-Za-z0-9.]$|^[A-Za-z0-9]$/;

/** The upload's filename as a blob name, or undefined when it isn't a safe flat name. */
export function safeBlobName(fileName: string | undefined): string | undefined {
	if (!fileName || fileName.length > 200 || fileName.includes('..')) {
		return undefined;
	}
	return SAFE_BLOB_NAME.test(fileName) ? fileName : undefined;
}

// os.tmpdir() can end in a separator - resolve() normalises it so the containment check
// below works on a clean prefix
const UPLOAD_DIR = path.resolve(tmpdir());

/**
 * Remove multer's temp upload. `req.file` fields are user-influenced, so only ever delete a
 * path that resolves inside the directory multer was given (os.tmpdir()). Used here and in
 * index.ts, where the post-multer CSRF check can fail before this controller is reached.
 */
export async function removeTempUpload(filePath: string | undefined): Promise<void> {
	if (!filePath) {
		return;
	}
	const resolved = path.resolve(filePath);
	if (!resolved.startsWith(UPLOAD_DIR + path.sep)) {
		return;
	}
	await unlink(resolved).catch(() => {});
}

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

		if (!file) {
			viewModel.error = 'Select a file to upload (up to 250MB).';
			return res.render(VIEW, viewModel);
		}

		try {
			if (!blobStoreConfig) {
				viewModel.error = 'Blob storage is not configured for this environment.';
				return res.render(VIEW, viewModel);
			}

			// req.file fields are user-influenced - only read/delete a path inside the temp dir
			// multer was configured with (see removeTempUpload for the delete side)
			const tempPath = path.resolve(file.path);
			if (!tempPath.startsWith(UPLOAD_DIR + path.sep)) {
				logger.warn(
					{ ...auditActor(req), fileName: file.originalname },
					'admin: rejected upload path outside temp dir'
				);
				viewModel.error = 'Could not upload the file to blob storage.';
				return res.render(VIEW, viewModel);
			}

			const blobName = safeBlobName(file.originalname);
			if (!blobName) {
				logger.warn({ ...auditActor(req), fileName: file.originalname }, 'admin: rejected unsafe blob name');
				viewModel.error = 'File names can only contain letters, numbers, dots, hyphens and underscores.';
				return res.render(VIEW, viewModel);
			}

			await uploadFile(tempPath, blobName, blobStoreConfig);
			viewModel.uploadedBlobName = blobName;
			logger.info({ ...auditActor(req), blobName, sizeBytes: file.size }, 'admin: uploaded file to blob storage');
		} catch (error) {
			logger.error({ ...auditActor(req), error }, 'Failed to upload file to blob storage');
			viewModel.error = 'Could not upload the file to blob storage.';
		} finally {
			await removeTempUpload(file.path);
		}

		return res.render(VIEW, viewModel);
	};
}
