import type { ReportCategory } from './report-consultees.ts';

export interface IdentifiedConsultee {
	/** The consultee category (e.g. "Parish Council") the count is for. */
	name: string;
	/** How many areas of this category the ruleset matched - as text, for the summary list. */
	count: string;
	changeUrl: string;
}

export interface ReportCheckViewModel {
	pageHeading: string;
	backLinkUrl: string;
	caseName: string;
	reference: string;
	/** Project stage - null when the data source doesn't carry one. */
	stage: string | null;
	caseChangeUrl: string;
	rulesetName: string;
	rulesetChangeUrl: string;
	/** One row per category the ruleset covers, in the ruleset's own order - zeros included. */
	consultees: IdentifiedConsultee[];
	/** The "Generate report" link - the report created confirmation page. */
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
