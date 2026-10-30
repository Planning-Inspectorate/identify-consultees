export interface IdentifiedConsultee {
	/** The consultee category (e.g. "Parish Council") the row is for. */
	name: string;
	/** Every consultee name in the category - the page shows the first few, then "Show more". */
	names: string[];
	changeUrl: string;
}

/**
 * The check page's broad groupings, following the prototype: the same groups the exported
 * workbook's tabs use (see export/workbook.ts's GROUP_TABS), so the page reads like the report.
 */
export interface ConsulteeGroup {
	/** The group's heading - an export tab's name. */
	name: string;
	consultees: IdentifiedConsultee[];
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
	/** The ruleset's categories under the export's group tabs - empty categories included. */
	groups: ConsulteeGroup[];
	/** The "Create report" link - the report created confirmation page. */
	generateReportUrl: string;
	/** True when the ruleset couldn't be run at all - the counts would be misleading zeros. */
	rulesetFailed: boolean;
	retryUrl: string;
	/** True when the site was screened against its bounding box - the list needs reviewing. */
	screenedBoundingBox: boolean;
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
	/**
	 * True when the report can't be served - the page's own build failed, or the download sent the
	 * user back with `download=failed`. The green confirmation panel is swapped for the heading and
	 * a GOV.UK error summary, and no download link.
	 */
	downloadFailed?: boolean;
	/** The download failure's error summary entry, linking to the retry. */
	errorSummary?: { text: string; href: string }[];
}
