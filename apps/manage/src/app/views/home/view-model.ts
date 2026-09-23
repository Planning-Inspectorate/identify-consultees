export interface HomeViewModel {
	pageHeading: string;
	rulesets: RulesetOption[];
	selectedRuleset: string;
	searchQuery: string;
	pageSize: number;
	pageSizeOptions: number[];
	resultsFrom: number;
	resultsTo: number;
	resultsTotal: number;
	geometries: ProjectGeometry[];
	selectedGeometryId: string | null;
}

export interface RulesetOption {
	value: string;
	text: string;
}

export interface ProjectGeometry {
	id: string;
	reference: string;
	caseName: string;
	geometryProjectStage: string;
	version: string;
	received: string;
	uploadedToCbos: string;
}
