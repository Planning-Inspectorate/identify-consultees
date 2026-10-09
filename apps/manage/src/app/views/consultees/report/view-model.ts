import type { ReportCategory } from './report-consultees.ts';

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
	rulesetName: string;
	downloadUrl: string;
	downloadText: string;
	/** The report's consultees by category, each with why it's in the report - see reportByCategory. */
	report: ReportCategory[];
	consulteeCount: number;
	/** True when the ruleset couldn't be run - the report's contents are unknown, not empty. */
	rulesetFailed: boolean;
	retryUrl: string;
}
