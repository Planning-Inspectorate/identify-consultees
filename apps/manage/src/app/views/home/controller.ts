import type { ManageService } from '#service';
import type { CaseBoundarySummary } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import { searchCaseBoundaries } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import { getRuleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import type { Request, Response } from 'express';
import type { CbosCaseRefresh } from '../../cbos/refresh-cases.ts';
import { boundaryUrl, changedStep } from '../consultees/report/urls.ts';
import { buildPagination } from './pagination.ts';
import type { HomeViewModel, ProjectGeometry } from './view-model.ts';

const PAGE_SIZE_OPTIONS = [25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;
// the search's own fields, which Refresh cases carries back to it
const SEARCH_FIELDS = ['q', 'pageSize', 'change', 'ruleset'];

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

function toProjectGeometry(
	summary: CaseBoundarySummary,
	changingProject?: { step: 'project'; rulesetId: string }
): ProjectGeometry {
	return {
		id: summary.id,
		href: boundaryUrl(summary.id, changingProject),
		reference: summary.reference,
		caseName: summary.caseName,
		stage: summary.acceptance
	};
}

/**
 * Step 1 of the identify-consultees flow: search for and pick a project. Picking one (see
 * views/home/view.njk) moves on to /consultees/:caseId - the project boundary page. Changing the
 * check page's project (`?change=project`), the search, its pages and its project links keep the
 * check page's ruleset, so the boundary page goes straight back to it.
 */
export function buildHomePage(service: ManageService): AsyncRequestHandler {
	const { db, logger } = service;

	return async (req, res) => {
		logger.info('identify consultees home page');

		const searchQuery = firstQueryValue(req.query.q);
		// the GET form always submits q, so no q param means a fresh load (or a page-size link)
		// while a present-but-blank q means Search was pressed with nothing entered
		const blankSearch = req.query.q !== undefined && searchQuery.trim() === '';
		const pageSize = parsePageSize(req.query.pageSize);
		const page = parsePage(req.query.page);

		// changing the check page's project: the search keeps its ruleset, for the project picked
		const change = changedStep(req.query);
		const changingProject =
			change?.step === 'project' && getRuleset(change.rulesetId)
				? { step: 'project' as const, rulesetId: change.rulesetId }
				: undefined;

		const hrefForPage = (targetPage: number): string => {
			const params = new URLSearchParams({
				// no q at all when nothing was searched - a blank q is a blank search, an error
				...(searchQuery ? { q: searchQuery } : {}),
				pageSize: String(pageSize),
				page: String(targetPage),
				...(changingProject ? { change: changingProject.step, ruleset: changingProject.rulesetId } : {})
			});
			return `/?${params.toString()}`;
		};

		let geometries: ProjectGeometry[] = [];
		let resultsTotal = 0;
		if (!blankSearch) {
			try {
				const { features, total } = await searchCaseBoundaries(db, {
					query: searchQuery,
					limit: pageSize,
					offset: (page - 1) * pageSize
				});
				geometries = features.map((summary) => toProjectGeometry(summary, changingProject));
				resultsTotal = total;
			} catch (error) {
				logger.error({ error }, 'Failed to search case boundaries');
			}
		}

		// A bookmarked/shared link can point past the last page once results shrink - send it to the
		// final page rather than rendering an empty table.
		const totalPages = Math.ceil(resultsTotal / pageSize);
		if (resultsTotal > 0 && page > totalPages) {
			return res.redirect(hrefForPage(totalPages));
		}

		const viewModel: HomeViewModel = {
			pageHeading: 'Identify consultees for a national infrastructure project',
			searchQuery,
			pageSize,
			page,
			resultsFrom: geometries.length > 0 ? (page - 1) * pageSize + 1 : 0,
			resultsTo: (page - 1) * pageSize + geometries.length,
			resultsTotal,
			geometries,
			pagination: buildPagination(page, totalPages, hrefForPage),
			...(changingProject ? { changingProject } : {}),
			...(req.query.refreshing === '1' ? { refreshing: true } : {}),
			...(blankSearch
				? {
						searchError: { text: 'Enter a search term' },
						errorSummary: [{ text: 'Enter a search term', href: '#q' }]
					}
				: {})
		};

		return res.render('views/home/view.njk', viewModel);
	};
}

/**
 * The search page's Refresh cases button: starts importing every case from CBOS (see
 * cbos/refresh-cases.ts) and goes straight back to the same search, which says it's under way - the
 * import takes minutes, so the search is run again once it's done.
 */
export function buildRefreshCases(service: Pick<ManageService, 'logger'>, refresh: CbosCaseRefresh) {
	return (req: Request, res: Response) => {
		const started = refresh.start();
		service.logger.info({ started }, started ? 'Refreshing cases from CBOS' : 'Cases are already being refreshed');

		const params = new URLSearchParams();
		for (const field of SEARCH_FIELDS) {
			const value = firstQueryValue(req.body?.[field]);
			if (value) {
				params.set(field, value);
			}
		}
		params.set('refreshing', '1');
		return res.redirect(`/?${params.toString()}`);
	};
}
