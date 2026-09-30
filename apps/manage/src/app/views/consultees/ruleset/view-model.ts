export interface RulesetOption {
	value: string;
	text: string;
}

export interface RulesetPickerViewModel {
	pageHeading: string;
	backLinkUrl: string;
	caseId: string;
	reference: string;
	caseName: string;
	rulesets: RulesetOption[];
}
