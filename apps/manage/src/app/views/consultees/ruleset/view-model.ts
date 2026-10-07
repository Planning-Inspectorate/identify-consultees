export interface RulesetOption {
	value: string;
	text: string;
	/** True for the currently-selected ruleset - the top option when none is selected yet. */
	checked: boolean;
}

export interface RulesetPickerViewModel {
	pageHeading: string;
	backLinkUrl: string;
	caseId: string;
	rulesets: RulesetOption[];
}
