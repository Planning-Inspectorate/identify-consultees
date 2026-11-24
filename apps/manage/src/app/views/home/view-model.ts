import type { PaginationViewModel } from './pagination.ts';

export interface HomeViewModel {
	pageHeading: string;
	/**
	 * The draft report the project is being changed for - the layout renders the "Back to draft
	 * report" link from these two. Only when the change link carried the check page's case.
	 */
	backLinkUrl?: string;
	backLinkText?: string;
	searchQuery: string;
	pageSize: number;
	page: number;
	resultsFrom: number;
	resultsTo: number;
	resultsTotal: number;
	geometries: ProjectGeometry[];
	/** govukPagination model - null when all results fit on one page. */
	pagination: PaginationViewModel | null;
	/** govukInput's errorMessage param - present only after a blank search submit. */
	searchError?: { text: string };
	/** The layout renders the summary itself - links to the search input. */
	errorSummary?: { text: string; href: string }[];
	/**
	 * Changing the check page's project - the search's forms carry it, the ruleset it keeps and,
	 * as hidden fields, the check page's case and selection so "Back to draft report" keeps
	 * working through a new search, a page link or Refresh cases.
	 */
	changingProject?: {
		step: 'project';
		rulesetId: string;
		/** The check page's case - the hidden `case` field, and the back link's report. */
		caseId?: string;
		/** The draft's selection as the compact `selection` param - one hidden field however long it is. */
		selectionParam?: string;
	};
	/** Refresh cases was just pressed - the page says CBOS's cases are being imported. */
	refreshing?: true;
	/** The search couldn't be run - the database didn't answer - so there are no results to show. */
	searchFailed?: true;
}

export interface ProjectGeometry {
	id: string;
	/** Its boundary page - keeping the check page's ruleset when changing its project. */
	href: string;
	reference: string;
	caseName: string;
	/** The case's stage (Pre-Examination), shown as plain text - case_boundary.acceptance, set by a CBOS import. */
	stage: string | null;
}
