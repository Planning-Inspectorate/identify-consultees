/** The add form's state: what was entered, and govukInput/govukTextarea errorMessage params. */
export interface AddConsulteeForm {
	nameValue: string;
	reasonValue: string;
	nameError?: { text: string };
	reasonError?: { text: string };
}

export interface AddConsulteeViewModel {
	/** "Add a consultee" - the heading above the name input and reason form. */
	pageHeading: string;
	/** The category being added to - the caption above the heading. */
	pageCaption: string;
	/** Back to the category page, keeping the current selection. */
	backLinkUrl: string;
	/** The form's POST target - this same URL, so the selection params ride along. */
	formAction: string;
	/**
	 * The consultees a typed name is matched against, nearest first, one each - for a consultee
	 * category its consultees only the nearby search found (and, after a name several share, every
	 * one of it), for Nearby NSIPs the other cases - suggested as it's typed (a datalist, enhanced by
	 * consultee-autocomplete.js). `name` is its label: those sharing a name read with what tells them
	 * apart, "Middleton (Lancaster)".
	 */
	nearbySuggestions: { name: string; hint: string }[];
	/**
	 * For a consultee category, where the autocomplete asks for more suggestions as a name is typed -
	 * the rest of the category's reference data (see buildReportConsulteeAddSuggestions).
	 */
	suggestionsUrl?: string;
	/** The name input's hint. */
	nameHint?: { text: string };
	/** The form's entered values and errors - errors only after a failed submit. */
	addForm: AddConsulteeForm;
	/** The layout's error summary - present only after a failed submit, one entry per field. */
	errorSummary?: { text: string; href: string }[];
}
