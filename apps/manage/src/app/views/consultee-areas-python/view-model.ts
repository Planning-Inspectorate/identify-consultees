export interface ConsulteeAreaRow {
	id: string;
	geometryType: string;
	sourceId: string | null;
	consulteeCategory: string | null;
	consulteeGroup: string | null;
	consulteeSubcategory: string | null;
	consulteeSubcategoryDescription: string | null;
	consultee: string | null;
	region: string | null;
	metadata: string;
	lastUpdated: string | null;
	geometryWkt: string;
}

export interface ConsulteeAreasPythonViewModel {
	pageHeading: string;
	rows?: ConsulteeAreaRow[];
	error?: string;
}
