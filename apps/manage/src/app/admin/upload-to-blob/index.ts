import type { ManageService } from '#service';
import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter } from 'express';
import express, { Router as createRouter } from 'express';
import multer from 'multer';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BlobStoreConfig, BlobUploader, BlockUploads } from './controller.ts';
import {
	buildCommitBlocks,
	buildRunUploadToBlob,
	buildStageBlock,
	buildUploadToBlobPage,
	CHUNK_BYTES,
	MAX_UPLOAD_BYTES
} from './controller.ts';

// disk, not memory storage - a multi-hundred-MB file shouldn't be held in process memory. The
// temp file is removed by the controller after the blob upload completes, whether it succeeds or
// fails. A file exceeding the limit is rejected by multer before it reaches the controller,
// surfacing as the app's generic error page - acceptable for this internal, low-traffic tool.
// The dedicated directory (rather than the shared os tmpdir) means a crash mid-upload only ever
// orphans files in here - createRoutes empties it when the app boots.
export const UPLOAD_TMP_DIR = join(tmpdir(), 'identify-consultees-uploads');
mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
const upload = multer({
	storage: multer.diskStorage({ destination: UPLOAD_TMP_DIR }),
	limits: { fileSize: MAX_UPLOAD_BYTES }
});

// a part's bytes, as they came - a little over a part's size, for any slack
const part = express.raw({ type: 'application/octet-stream', limit: CHUNK_BYTES + 1024 });

export function createRoutes(
	service: ManageService,
	uploadFile?: BlobUploader,
	uploadsFor?: (blobStoreConfig: BlobStoreConfig) => BlockUploads
): IRouter {
	const router = createRouter({ mergeParams: true });
	// sweep anything a previous process left mid-upload - its unlink in the controller never ran
	for (const leftover of readdirSync(UPLOAD_TMP_DIR)) {
		rmSync(join(UPLOAD_TMP_DIR, leftover), { force: true, recursive: true });
	}
	const uploadToBlobPage = buildUploadToBlobPage();
	const runUploadToBlob = buildRunUploadToBlob(service, uploadFile);

	router.get('/', asyncHandler(uploadToBlobPage));
	// without JavaScript: the whole file in one request - fine for a small one
	router.post('/run', upload.single('file'), asyncHandler(runUploadToBlob));
	// with it (public/javascripts/blob-upload.js): the file a part at a time, then committed
	router.post('/blocks', part, asyncHandler(buildStageBlock(service, uploadsFor)));
	router.post('/commit', asyncHandler(buildCommitBlocks(service, uploadsFor)));

	return router;
}
