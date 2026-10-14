export interface ImportReferenceDataViewModel {
	pageHeading: string;
	error?: string;
	consulteeAreasImported?: number;
	caseBoundariesImported?: number;
	/** Rows in each table now - how to confirm an import finished if the request timed out. */
	loadedConsulteeAreas?: number;
	loadedCaseBoundaries?: number;
}
