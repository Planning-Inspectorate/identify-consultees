export interface IdentifiedConsultee {
	/** The consultee category (e.g. "Parish Council") the row is for. */
	name: string;
	/** The category's consultee names, capped at the first few (see total for the real count). */
	names: string[];
	/** How many consultees the category has in total - may exceed names.length. */
	total: number;
	changeUrl: string;
}

export interface ReportCheckViewModel {
	pageHeading: string;
	backLinkUrl: string;
	caseName: string;
	reference: string;
	caseChangeUrl: string;
	/** The shapefile the report runs against. */
	shapefileName: string;
	shapefileChangeUrl: string;
	rulesetName: string;
	rulesetChangeUrl: string;
	/** One row per category the ruleset covers, in the ruleset's own order - zeros included. */
	consultees: IdentifiedConsultee[];
	/** The "Create report" link - the report created confirmation page. */
	generateReportUrl: string;
	/** True when the ruleset couldn't be run at all - the counts would be misleading zeros. */
	rulesetFailed: boolean;
	retryUrl: string;
}

export interface ReportCreatedViewModel {
	pageHeading: string;
	backLinkUrl: string;
	caseName: string;
	reference: string;
	downloadUrl: string;
	/** The download link's text, with the built report's size when it built - "(ZIP, 1.4MB)". */
	downloadText: string;
	/** True when the ruleset couldn't be run - the report couldn't be created. */
	rulesetFailed: boolean;
	retryUrl: string;
}
