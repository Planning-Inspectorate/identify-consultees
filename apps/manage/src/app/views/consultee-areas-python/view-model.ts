export interface ConsulteeAreaRow {
	id: string;
	geometryType: string;
	consulteeCategory: string | null;
	consultee: string | null;
	region: string | null;
	caseReference: string | null;
	currentVersion: number;
	metadata: string;
	lastUpdated: string | null;
	geometryWkt: string;
}

export interface ConsulteeAreasPythonViewModel {
	pageHeading: string;
	rows?: ConsulteeAreaRow[];
	error?: string;
}
