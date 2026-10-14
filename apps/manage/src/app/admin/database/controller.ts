import type { ManageService } from '#service';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import type { Request, Response } from 'express';
import { buildPagination } from '../../views/home/pagination.ts';
import {
	caseBoundaryRow,
	consulteeAreaRow,
	databaseOverview,
	listCaseBoundaryRows,
	listConsulteeAreaRows,
	PAGE_SIZE
} from './data.ts';

/**
 * The Database admin pages: what's loaded in this environment's database. An overview of each
 * table and the consultee areas by category; a page of either table's rows, filtered; and one row
 * with every column but its geometry. Read only.
 */

const VIEWS = {
	overview: 'admin/database/overview.njk',
	consulteeAreas: 'admin/database/consultee-areas.njk',
	caseBoundaries: 'admin/database/case-boundaries.njk',
	row: 'admin/database/row.njk'
};

export const CONSULTEE_AREAS_URL = '/admin/database/consultee-areas';
export const CASE_BOUNDARIES_URL = '/admin/database/case-boundaries';

/** A query param as one trimmed string - a repeated or non-string param reads as empty. */
function queryText(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

/** The requested page number - anything that isn't a whole number from 1 reads as the first page. */
function queryPage(value: unknown): number {
	const page = Number(queryText(value));
	return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** A date and time as the admin pages show them: "14 Oct 2026, 09:05", UK time. */
export function formatDateTime(date: Date | null): string {
	if (!date) {
		return '';
	}
	return date.toLocaleString('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'Europe/London'
	});
}

/** A list page's URL with its filters and page - empty filters, and page 1, left out. */
export function listUrl(base: string, params: Record<string, string | number>): string {
	const query = new URLSearchParams(
		Object.entries(params)
			.filter(([key, value]) => value !== '' && !(key === 'page' && value === 1))
			.map(([key, value]) => [key, String(value)])
	).toString();
	return query ? `${base}?${query}` : base;
}

/** "Showing 51 to 100 of 1,234" for a page of rows. */
function showing(page: number, shown: number, total: number): string {
	if (total === 0) {
		return 'No rows match.';
	}
	const first = (page - 1) * PAGE_SIZE + 1;
	return `Showing ${first.toLocaleString('en-GB')} to ${(first + shown - 1).toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')} rows.`;
}

export function buildDatabaseOverviewPage(service: ManageService): AsyncRequestHandler {
	return async (_req, res) => {
		const overview = await databaseOverview(service.db);
		res.render(VIEWS.overview, {
			pageHeading: 'Database',
			tables: [
				{
					name: 'consultee_area',
					description: 'The reference data: every consultee and its area.',
					rows: overview.consulteeAreas.rows.toLocaleString('en-GB'),
					lastUpdated: formatDateTime(overview.consulteeAreas.lastUpdated),
					href: CONSULTEE_AREAS_URL
				},
				{
					name: 'case_boundary',
					description: 'Every case boundary file, from the import or CBOS.',
					rows: overview.caseBoundaries.rows.toLocaleString('en-GB'),
					lastUpdated: formatDateTime(overview.caseBoundaries.lastUpdated),
					href: CASE_BOUNDARIES_URL
				}
			],
			categories: overview.categories.map(({ category, rows }) => ({
				name: category ?? 'No category',
				rows: rows.toLocaleString('en-GB'),
				// rows with no category can't be filtered to - the list shows every category instead
				href: category === null ? undefined : listUrl(CONSULTEE_AREAS_URL, { category })
			}))
		});
	};
}

export function buildConsulteeAreasPage(service: ManageService): AsyncRequestHandler {
	return async (req, res) => {
		const filter = {
			category: queryText(req.query.category),
			search: queryText(req.query.q),
			page: queryPage(req.query.page)
		};
		const [{ rows, total }, overview] = await Promise.all([
			listConsulteeAreaRows(service.db, filter),
			databaseOverview(service.db)
		]);
		const hrefForPage = (page: number) =>
			listUrl(CONSULTEE_AREAS_URL, { category: filter.category, q: filter.search, page });
		res.render(VIEWS.consulteeAreas, {
			pageHeading: 'Consultee areas',
			backLinkUrl: '/admin/database',
			categoryItems: [
				{ value: '', text: 'Every category', selected: filter.category === '' },
				...overview.categories
					.filter(({ category }) => category !== null)
					.map(({ category }) => ({ value: category, text: category, selected: category === filter.category }))
			],
			search: filter.search,
			showing: showing(filter.page, rows.length, total),
			rows: rows.map((row) => ({
				href: `${CONSULTEE_AREAS_URL}/${row.id.toLowerCase()}`,
				consultee: row.consultee ?? 'Unnamed consultee',
				category: row.consulteeCategory ?? '',
				region: row.region ?? '',
				geometryType: row.geometryType,
				lastUpdated: formatDateTime(row.lastUpdated)
			})),
			pagination: buildPagination(filter.page, Math.ceil(total / PAGE_SIZE), hrefForPage)
		});
	};
}

export function buildCaseBoundariesPage(service: ManageService): AsyncRequestHandler {
	return async (req, res) => {
		const filter = { search: queryText(req.query.q), page: queryPage(req.query.page) };
		const { rows, total } = await listCaseBoundaryRows(service.db, filter);
		const hrefForPage = (page: number) => listUrl(CASE_BOUNDARIES_URL, { q: filter.search, page });
		res.render(VIEWS.caseBoundaries, {
			pageHeading: 'Case boundaries',
			backLinkUrl: '/admin/database',
			search: filter.search,
			showing: showing(filter.page, rows.length, total),
			rows: rows.map((row) => ({
				href: `${CASE_BOUNDARIES_URL}/${row.id.toLowerCase()}`,
				caseReference: row.caseReference,
				caseName: row.caseName,
				fileName: row.fileName ?? '',
				receivedDate: formatDateTime(row.receivedDate),
				geometryType: row.geometryType
			})),
			pagination: buildPagination(filter.page, Math.ceil(total / PAGE_SIZE), hrefForPage)
		});
	};
}

/** A stored value as the row page shows it - dates in UK time, empty for null. */
function cellText(value: unknown): string {
	if (value instanceof Date) {
		return formatDateTime(value);
	}
	return value === null || value === undefined ? '' : String(value);
}

/** Metadata as indented JSON when it parses, else as stored. */
export function prettyMetadata(metadata: string): string {
	try {
		return JSON.stringify(JSON.parse(metadata), null, 2);
	} catch {
		return metadata;
	}
}

function renderRow(
	res: Response,
	heading: string,
	backLinkUrl: string,
	row: Record<string, unknown> & { metadata: string }
): void {
	const { metadata, ...columns } = row;
	res.render(VIEWS.row, {
		pageHeading: heading,
		backLinkUrl,
		columns: Object.entries(columns).map(([name, value]) => ({ name, value: cellText(value) })),
		metadata: prettyMetadata(metadata)
	});
}

function notFound(res: Response): void {
	res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
}

// both tables' ids are UNIQUEIDENTIFIERs - anything else can't match, and isn't worth a query
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The row id a request names, if it could be one. */
function rowId(req: Request): string | undefined {
	const id = String(req.params.id ?? '');
	return UUID_PATTERN.test(id) ? id : undefined;
}

export function buildConsulteeAreaRowPage(service: ManageService): AsyncRequestHandler {
	return async (req, res) => {
		const id = rowId(req);
		const row = id ? await consulteeAreaRow(service.db, id) : null;
		if (!row) {
			return notFound(res);
		}
		renderRow(res, row.consultee ?? 'Unnamed consultee', CONSULTEE_AREAS_URL, row);
	};
}

export function buildCaseBoundaryRowPage(service: ManageService): AsyncRequestHandler {
	return async (req, res) => {
		const id = rowId(req);
		const row = id ? await caseBoundaryRow(service.db, id) : null;
		if (!row) {
			return notFound(res);
		}
		renderRow(res, `${row.caseReference} ${row.caseName}`, CASE_BOUNDARIES_URL, row);
	};
}
