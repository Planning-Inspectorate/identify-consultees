import type { ManageService } from '#service';
import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import multer from 'multer';
import { tmpdir } from 'node:os';
import type { BlobUploader } from './controller.ts';
import { buildRunUploadToBlob, buildUploadToBlobPage } from './controller.ts';

// large reference data exports (tens of MB) are the motivating use case - see
// packages/database/src/seed/import-from-blob.ts - but this isn't restricted to one file type.
const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;

// disk, not memory storage - a multi-hundred-MB file shouldn't be held in process memory. The
// temp file is removed by the controller after the blob upload completes, whether it succeeds or
// fails. A file exceeding the limit is rejected by multer before it reaches the controller,
// surfacing as the app's generic error page - acceptable for this internal, low-traffic tool.
const upload = multer({
	storage: multer.diskStorage({ destination: tmpdir() }),
	limits: { fileSize: MAX_UPLOAD_BYTES }
});

export function createRoutes(service: ManageService, uploadFile?: BlobUploader): IRouter {
	const router = createRouter({ mergeParams: true });
	const uploadToBlobPage = buildUploadToBlobPage();
	const runUploadToBlob = buildRunUploadToBlob(service, uploadFile);

	router.get('/', asyncHandler(uploadToBlobPage));
	router.post('/run', upload.single('file'), asyncHandler(runUploadToBlob));

	return router;
}
