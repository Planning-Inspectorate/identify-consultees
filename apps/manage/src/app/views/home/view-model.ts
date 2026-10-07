import type { PaginationViewModel } from './pagination.ts';

export interface HomeViewModel {
	pageHeading: string;
	searchQuery: string;
	pageSize: number;
	pageSizeOptions: number[];
	page: number;
	resultsFrom: number;
	resultsTo: number;
	resultsTotal: number;
	geometries: ProjectGeometry[];
	/** govukPagination model - null when all results fit on one page. */
	pagination: PaginationViewModel | null;
	/** A real case reference/name to show as a "try searching for..." example. Null if none exist yet. */
	exampleCase: ExampleCase | null;
}

export interface ExampleCase {
	reference: string;
	caseName: string;
}

export interface ProjectGeometry {
	id: string;
	reference: string;
	caseName: string;
	/** Project stage shown as a tag - sourced from case_boundary.acceptance (unpopulated today). */
	stage: string | null;
}
