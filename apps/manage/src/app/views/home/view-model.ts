export interface HomeViewModel {
	pageHeading: string;
	searchQuery: string;
	pageSize: number;
	pageSizeOptions: number[];
	resultsFrom: number;
	resultsTo: number;
	resultsTotal: number;
	geometries: ProjectGeometry[];
}

export interface ProjectGeometry {
	id: string;
	reference: string;
	caseName: string;
	// formatted from case_boundary.receivedDate - empty string when not set, real seed data
	// doesn't populate this for every row
	received: string;
}
