export interface ErrorScenario {
	href: string;
	label: string;
	description: string;
}

export interface ErrorTestIndexViewModel {
	pageHeading: string;
	/** Renders of the real error templates, one per status. */
	statusPages: ErrorScenario[];
	/** Real routes that serve an error page or exercise the catch-all. */
	livePages: ErrorScenario[];
	csrfCheckAction: string;
	rateLimitedHref: string;
	/** Set by the CSRF check's success path to show its confirmation banner. */
	csrfAccepted?: boolean;
}
