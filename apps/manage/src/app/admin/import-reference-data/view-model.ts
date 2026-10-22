/** A group of the reference data as the page shows it - see config/reference-data.yaml's groups. */
export interface GroupStatus {
	name: string;
	slug: string;
	/** Its consultee categories, comma-separated. */
	categories: string;
	/** Its newest file in blob storage - absent when there's none. */
	file?: { name: string; dataDate: string; quarter: string; size: string };
	/** Its consultee areas loaded now - absent if they couldn't be counted. */
	rows?: number;
	/** Its last load into the dataset in use - absent when it hasn't been loaded since loads were logged. */
	load?: { blobName: string; quarter: string; loadedAt: string; rowsLoaded: number };
	/** Its rows in a newer quarter being loaded - absent when there's none. */
	pendingRows?: number;
}

/** A quarter's dataset - its table - as the page lists it. */
export interface DatasetStatus {
	quarter: string;
	rows: number;
	/** In use, Loading (newer, waiting for groups) or Archive (older). */
	status: string;
}

export interface ImportReferenceDataViewModel {
	pageHeading: string;
	error?: string;
	/** What loading a group did, said on the page. */
	groupLoaded?: string;
	consulteeAreasCleared?: number;
	caseBoundariesImported?: number;
	/** Rows in each table now - how to confirm a load finished if the request timed out. */
	loadedConsulteeAreas?: number;
	loadedCaseBoundaries?: number;
	/** The quarter whose table the tool uses - consultee_area_2026Q4. */
	datasetInUse?: string;
	datasets?: DatasetStatus[];
	/** A newer quarter being loaded, and the groups it still needs before it's used. */
	pending?: { quarter: string; waitingFor: string[] };
	/** False when blob storage couldn't be listed - no group's file can be shown. */
	blobStorageRead?: boolean;
	groups?: GroupStatus[];
}
