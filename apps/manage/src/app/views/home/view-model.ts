import type { PaginationViewModel } from './pagination.ts';

export interface HomeViewModel {
	pageHeading: string;
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
	/** Changing the check page's project - the search form carries it, and the ruleset it keeps. */
	changingProject?: { step: 'project'; rulesetId: string };
}

export interface ProjectGeometry {
	id: string;
	/** Its boundary page - keeping the check page's ruleset when changing its project. */
	href: string;
	reference: string;
	caseName: string;
	/** The case's stage (Pre-Examination), shown as a tag - case_boundary.acceptance, set by a CBOS import. */
	stage: string | null;
}
