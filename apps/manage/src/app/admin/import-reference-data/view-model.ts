export interface ImportReferenceDataViewModel {
	pageHeading: string;
	error?: string;
	consulteeAreasImported?: number;
	/** Whether that import replaced only the file's categories, or every consultee area. */
	consulteeAreasScope?: 'categories' | 'all';
	caseBoundariesImported?: number;
	/** Rows in each table now - how to confirm an import finished if the request timed out. */
	loadedConsulteeAreas?: number;
	loadedCaseBoundaries?: number;
}
