export interface RulesetOption {
	value: string;
	text: string;
	/** True for the currently-selected ruleset - the top option when none is selected yet. */
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
}
