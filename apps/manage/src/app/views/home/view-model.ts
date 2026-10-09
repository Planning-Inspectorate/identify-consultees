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
}

export interface ProjectGeometry {
	id: string;
	reference: string;
	caseName: string;
	/** Project stage shown as a tag - sourced from case_boundary.acceptance (unpopulated today). */
	stage: string | null;
}
