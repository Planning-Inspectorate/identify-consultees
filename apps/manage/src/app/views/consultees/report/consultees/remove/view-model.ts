export interface RemoveConsulteeViewModel {
	/** "Remove consultee" - the heading above the consultee's details and reason form. */
	pageHeading: string;
	/** The case name - the caption above the heading. */
	pageCaption: string;
	/** Back to the category page, keeping the current selection. */
	backLinkUrl: string;
	/** The form's POST target - this same URL, so the selection and target params ride along. */
	formAction: string;
	/** The consultee being removed - the single row of the summary table. */
	name: string;
	/** Every reason it was identified, one per line - same as the category page's Identified column. */
	identified: string[];
	/** Entered value, re-rendered when the form fails validation. */
	reasonValue: string;
	/** govukTextarea's errorMessage param - present only when the reason was missing. */
	reasonError?: { text: string };
	/** The layout's error summary - present only on a failed submit. */
	errorSummary?: { text: string; href: string }[];
	/**
	 * True when the target is a ruleset match and the run failed - the match can't be resolved,
	 * so the page shows an error with a retry link instead of the form.
	 */
	rulesetFailed: boolean;
	retryUrl: string;
}
