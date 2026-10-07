export interface ShapefileOption {
	/** The case_boundary id - picking it lands on the map page for that boundary. */
	value: string;
	text: string;
	/** govukRadios item hint: the file's upload timestamp, when it has one. */
	hint?: { text: string };
	checked: boolean;
}

export interface ShapefilePickerViewModel {
	pageHeading: string;
	backLinkUrl: string;
	caseId: string;
	/** Carried through the POST so saving a shapefile keeps the current ruleset. */
	rulesetId: string;
	files: ShapefileOption[];
}
