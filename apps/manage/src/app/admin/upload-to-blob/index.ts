import type { ManageService } from '#service';
import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter, RequestHandler } from 'express';
import express, { Router as createRouter } from 'express';
import multer from 'multer';
import { tmpdir } from 'node:os';
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
const upload = multer({
	storage: multer.diskStorage({ destination: tmpdir() }),
	limits: { fileSize: MAX_UPLOAD_BYTES }
});

// a whole-file upload lands in tmpdir before streaming to Azure - up to a gigabyte each - and each
// staged part buffers its chunk in memory. Cap how many run at once so a burst can't fill the disk
// or the heap; a request over the cap gets a 429 and a nudge to retry rather than queueing a
// gigabyte of body bytes on a held connection
const MAX_CONCURRENT_UPLOADS = 4;

// the upload page sends PARALLEL_PARTS (4) parts at once, so /blocks needs a few times that for
// more than one upload - a second tab or admin - to get slots before its retries run out. 16 caps
// the parts buffered in memory at ~128MB while letting about four uploads run at full parallelism
const MAX_CONCURRENT_PARTS = 16;

export function limitInFlightUploads(max: number): RequestHandler {
	let inFlight = 0;
	return (_req, res, next) => {
		if (inFlight >= max) {
			res.setHeader('Retry-After', '30');
			res.status(429).send('Another upload is still running; try again shortly.');
			return;
		}
		inFlight += 1;
		let released = false;
		// 'finish' covers a completed upload, 'close' a connection dropped mid-way
		const release = () => {
			if (!released) {
				released = true;
				inFlight -= 1;
			}
		};
		res.once('finish', release);
		res.once('close', release);
		next();
	};
}

// a part's bytes, as they came - a little over a part's size, for any slack
const part = express.raw({ type: 'application/octet-stream', limit: CHUNK_BYTES + 1024 });

export function createRoutes(
	service: ManageService,
	uploadFile?: BlobUploader,
	uploadsFor?: (blobStoreConfig: BlobStoreConfig) => BlockUploads
): IRouter {
	const router = createRouter({ mergeParams: true });
	const uploadToBlobPage = buildUploadToBlobPage();
	const runUploadToBlob = buildRunUploadToBlob(service, uploadFile);

	router.get('/', asyncHandler(uploadToBlobPage));
	// without JavaScript: the whole file in one request - fine for a small one
	router.post(
		'/run',
		limitInFlightUploads(MAX_CONCURRENT_UPLOADS),
		upload.single('file'),
		asyncHandler(runUploadToBlob)
	);
	// with it (public/javascripts/blob-upload.js): the file a part at a time, then committed
	router.post(
		'/blocks',
		limitInFlightUploads(MAX_CONCURRENT_PARTS),
		part,
		asyncHandler(buildStageBlock(service, uploadsFor))
	);
	router.post('/commit', asyncHandler(buildCommitBlocks(service, uploadsFor)));

	return router;
}
