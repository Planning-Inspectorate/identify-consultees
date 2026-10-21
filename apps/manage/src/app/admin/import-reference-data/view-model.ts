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
	/** Its last load - absent when it hasn't been loaded since loads were logged. */
	load?: { blobName: string; quarter: string; loadedAt: string; rowsLoaded: number; rowsArchived: number };
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
	/** False when blob storage couldn't be listed - no group's file can be shown. */
	blobStorageRead?: boolean;
	groups?: GroupStatus[];
}
