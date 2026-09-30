import type { ManageService } from '#service';
import type { CaseBoundarySummary } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import {
	getRandomCaseSummary,
	searchCaseBoundaries
} from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
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

function toProjectGeometry(summary: CaseBoundarySummary): ProjectGeometry {
	return {
		id: summary.id,
		reference: summary.reference,
		caseName: summary.caseName,
		received: summary.receivedDate ? summary.receivedDate.toLocaleDateString('en-GB') : ''
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

		let geometries: ProjectGeometry[] = [];
		let resultsTotal = 0;
		try {
			const { features, total } = await searchCaseBoundaries(db, { query: searchQuery, limit: pageSize });
			geometries = features.map(toProjectGeometry);
			resultsTotal = total;
		} catch (error) {
			logger.error({ error }, 'Failed to search case boundaries');
		}

		let exampleCase: ExampleCase | null = null;
		try {
			const summary = await getRandomCaseSummary(db);
			exampleCase = summary ? { reference: summary.reference, caseName: summary.caseName } : null;
		} catch (error) {
			logger.error({ error }, 'Failed to fetch an example case for the home page');
		}

		const viewModel: HomeViewModel = {
			pageHeading: 'Identify consultees for an infrastructure project',
			searchQuery,
			pageSize,
			pageSizeOptions: PAGE_SIZE_OPTIONS,
			resultsFrom: geometries.length > 0 ? 1 : 0,
			resultsTo: geometries.length,
			resultsTotal,
			geometries,
			exampleCase
		};

		return res.render('views/home/view.njk', viewModel);
	};
}
