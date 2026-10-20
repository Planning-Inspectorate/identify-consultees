export interface UploadToBlobViewModel {
	pageHeading: string;
	error?: string;
	uploadedBlobName?: string;
	/** The size of the parts the page's script sends a file in - see controller.ts's CHUNK_BYTES. */
	chunkBytes?: number;
	maxUploadBytes?: number;
}
