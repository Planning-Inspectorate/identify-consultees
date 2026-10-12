export interface AddConsulteeViewModel {
	/** "Add consultee" - the heading above the name input and reason form. */
	pageHeading: string;
	/** The category being added to - the caption above the heading. */
	pageCaption: string;
	/** Back to the category page, keeping the current selection. */
	backLinkUrl: string;
	/** The form's POST target - this same URL, so the selection params ride along. */
	formAction: string;
	/** Entered values, re-rendered when the form fails validation. */
	nameValue: string;
	reasonValue: string;
	/** govukInput's errorMessage param - present only when the name was missing. */
	nameError?: { text: string };
	/** govukTextarea's errorMessage param - present only when the reason was missing. */
	reasonError?: { text: string };
	/** The layout's error summary - present only on a failed submit, one entry per missing field. */
	errorSummary?: { text: string; href: string }[];
}
