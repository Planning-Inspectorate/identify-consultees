import type { ManageService } from '#service';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { DUMMY_GEOMETRIES, RULESETS } from '../../data/dummy-geometries.ts';
import type { HomeViewModel } from './view-model.ts';

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

function filterGeometries(searchQuery: string) {
	const normalised = searchQuery.trim().toLowerCase();
	if (!normalised) {
		return DUMMY_GEOMETRIES;
	}

	return DUMMY_GEOMETRIES.filter(
		(geometry) =>
			geometry.reference.toLowerCase().includes(normalised) || geometry.caseName.toLowerCase().includes(normalised)
	);
}

/**
 * Prefer the live case_boundary count. While the UI still uses dummy rows and the
 * table is empty (or unreachable), fall back to the dummy dataset size so the
 * summary stays coherent.
 */
async function resolveResultsTotal(
	db: ManageService['db'],
	searchQuery: string,
	filteredLength: number
): Promise<number> {
	if (searchQuery) {
		return filteredLength;
	}

	try {
		const databaseCount = await db.caseBoundary.count();
		return databaseCount > 0 ? databaseCount : DUMMY_GEOMETRIES.length;
	} catch {
		return DUMMY_GEOMETRIES.length;
	}
}

export function buildHomePage(service: ManageService): AsyncRequestHandler {
	const { db, logger } = service;

	return async (req, res) => {
		logger.info('identify consultees home page');

		const searchQuery = firstQueryValue(req.query.q);
		const selectedRuleset = firstQueryValue(req.query.ruleset) || RULESETS[0]?.value || '';
		const pageSize = parsePageSize(req.query.pageSize);
		const filtered = filterGeometries(searchQuery);
		const pageGeometries = filtered.slice(0, pageSize);
		const selectedGeometryId = firstQueryValue(req.query.geometryId) || pageGeometries[0]?.id || null;
		const resultsTotal = await resolveResultsTotal(db, searchQuery, filtered.length);

		const viewModel: HomeViewModel = {
			pageHeading: 'Identify consultees for an infrastructure project',
			rulesets: RULESETS,
			selectedRuleset,
			searchQuery,
			pageSize,
			pageSizeOptions: PAGE_SIZE_OPTIONS,
			resultsFrom: pageGeometries.length > 0 ? 1 : 0,
			resultsTo: pageGeometries.length,
			resultsTotal,
			geometries: pageGeometries,
			selectedGeometryId
		};

		return res.render('views/home/view.njk', viewModel);
	};
}
