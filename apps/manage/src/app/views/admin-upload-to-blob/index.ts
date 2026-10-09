import type { ManageService } from '#service';
import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter, RequestHandler } from 'express';
import { Router as createRouter } from 'express';
import lusca from 'lusca';
import multer from 'multer';
import { tmpdir } from 'node:os';
import type { BlobUploader } from './controller.ts';
import { buildRunUploadToBlob, buildUploadToBlobPage, removeTempUpload } from './controller.ts';

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

// lusca can't read the _csrf field out of a multipart body, so the app-level middleware
// skips this route (multiPartFormRoutes in app.ts). Multer has parsed the form fields by
// this point, so the same token check runs here instead - and the temp upload multer wrote
// is removed if the check fails, since the controller's cleanup never gets reached.
const csrfProtection = lusca.csrf();

const assertCsrfToken: RequestHandler = (req, res, next) => {
	csrfProtection(req, res, (error?: unknown) => {
		if (!error) {
			return next();
		}
		const file = req.file;
		if (!file) {
			return next(error);
		}
		void removeTempUpload(file.path).then(() => next(error));
	});
};

export function createRoutes(service: ManageService, uploadFile?: BlobUploader): IRouter {
	const router = createRouter({ mergeParams: true });
	const uploadToBlobPage = buildUploadToBlobPage();
	const runUploadToBlob = buildRunUploadToBlob(service, uploadFile);

	router.get('/', asyncHandler(uploadToBlobPage));
	router.post('/run', upload.single('file'), assertCsrfToken, asyncHandler(runUploadToBlob));

	return router;
}
