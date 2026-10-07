import type { ManageService } from '#service';
import type { CaseBoundarySummary } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import {
	getRandomCaseSummary,
	searchCaseBoundaries
} from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { buildPagination } from './pagination.ts';
import type { ExampleCase, HomeViewModel, ProjectGeometry } from './view-model.ts';

const PAGE_SIZE_OPTIONS = [25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

function firstQueryValue(value: unknown): string {
	if (Array.isArray(value)) {
		return typeof value[0] === 'string' ? value[0] : '';
	}
	return typeof value === 'string' ? value : '';
}

function parsePageSize(value: unknown): number {
	const parsed = Number.parseInt(firstQueryValue(value), 10);
	return PAGE_SIZE_OPTIONS.includes(parsed) ? parsed : DEFAULT_PAGE_SIZE;
}

function parsePage(value: unknown): number {
	const parsed = Number.parseInt(firstQueryValue(value), 10);
	return parsed >= 1 ? parsed : 1;
}

function toProjectGeometry(summary: CaseBoundarySummary): ProjectGeometry {
	return {
		id: summary.id,
		reference: summary.reference,
		caseName: summary.caseName,
		stage: summary.acceptance
	};
}

/**
 * Step 1 of the identify-consultees flow: search for and pick a project. Picking one (see
 * views/home/view.njk) moves on to /consultees/:caseId to choose a ruleset.
 */
export function buildHomePage(service: ManageService): AsyncRequestHandler {
	const { db, logger } = service;

	return async (req, res) => {
		logger.info('identify consultees home page');

		const searchQuery = firstQueryValue(req.query.q);
		const pageSize = parsePageSize(req.query.pageSize);
		const page = parsePage(req.query.page);

		const hrefForPage = (targetPage: number): string => {
			const params = new URLSearchParams({
				q: searchQuery,
				pageSize: String(pageSize),
				page: String(targetPage)
			});
			return `/?${params.toString()}`;
		};

		let geometries: ProjectGeometry[] = [];
		let resultsTotal = 0;
		try {
			const { features, total } = await searchCaseBoundaries(db, {
				query: searchQuery,
				limit: pageSize,
				offset: (page - 1) * pageSize
			});
			geometries = features.map(toProjectGeometry);
			resultsTotal = total;
		} catch (error) {
			logger.error({ error }, 'Failed to search case boundaries');
		}

		// A bookmarked/shared link can point past the last page once results shrink - send it to the
		// final page rather than rendering an empty table.
		const totalPages = Math.ceil(resultsTotal / pageSize);
		if (resultsTotal > 0 && page > totalPages) {
			return res.redirect(hrefForPage(totalPages));
		}

		let exampleCase: ExampleCase | null = null;
		try {
			const summary = await getRandomCaseSummary(db);
			exampleCase = summary ? { reference: summary.reference, caseName: summary.caseName } : null;
		} catch (error) {
			logger.error({ error }, 'Failed to fetch an example case for the home page');
		}

		const viewModel: HomeViewModel = {
			pageHeading: 'Identify consultees for a NSIP project',
			searchQuery,
			pageSize,
			pageSizeOptions: PAGE_SIZE_OPTIONS,
			page,
			resultsFrom: geometries.length > 0 ? (page - 1) * pageSize + 1 : 0,
			resultsTo: (page - 1) * pageSize + geometries.length,
			resultsTotal,
			geometries,
			pagination: buildPagination(page, totalPages, hrefForPage),
			exampleCase
		};

		return res.render('views/home/view.njk', viewModel);
	};
}
