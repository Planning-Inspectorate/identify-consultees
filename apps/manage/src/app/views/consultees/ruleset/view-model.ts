export interface RulesetOption {
	value: string;
	text: string;
	/**
	 * True only when this option is the user's existing answer (carried back in `?ruleset=` by
	 * the check page's "Change"/back links). Never pre-selected on a first visit - see the
	 * Design System radios guidance.
	 */
	checked: boolean;
}

export interface RulesetPickerViewModel {
	pageHeading: string;
	/** The case name - sits above the "Ruleset" heading as a caption. */
	pageCaption: string;
	backLinkUrl: string;
	caseId: string;
	/** Where the "Identify consultees" form posts - carries any consultee selection through. */
	formAction: string;
	rulesets: RulesetOption[];
	/** govukRadios' errorMessage param - present only after an unanswered submit. */
	rulesetError?: { text: string };
	/** The layout renders the summary itself - links to the radios fieldset. */
	errorSummary?: { text: string; href: string }[];
}
