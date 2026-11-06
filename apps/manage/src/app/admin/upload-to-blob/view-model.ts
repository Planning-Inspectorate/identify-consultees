/** The page's Copy section - see copy.ts. */
export interface CopySection {
	from: 'Test' | 'Training';
	to: 'Training' | 'Prod';
	/** Whether the copy waits for approval in Azure DevOps - Prod's. */
	needsApproval: boolean;
	/** The latest copy is still running, so another can't be started. */
	running: boolean;
	latest?: { status: { text: string; colour: string }; queuedAt: string; finishedAt?: string; url: string };
	/** After asking for one: it started, or one was running already. */
	notice?: 'started' | 'running';
	/** Azure DevOps couldn't be read, or the copy couldn't be started - why. */
	error?: string;
}

export interface UploadToBlobViewModel {
	pageHeading: string;
	copy?: CopySection;
	error?: string;
	uploadedBlobName?: string;
	/** The size of the parts the page's script sends a file in - see controller.ts's CHUNK_BYTES. */
	chunkBytes?: number;
	maxUploadBytes?: number;
	/** The groups of the reference data a file can be uploaded for - config/reference-data.yaml's. */
	groups?: { name: string; slug: string; categories: string }[];
}
