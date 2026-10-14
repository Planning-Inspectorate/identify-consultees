import type { ManageService } from '#service';

/**
 * What the Database admin pages read: each table's size, the consultee areas by category, a page
 * of either table's rows (filtered), and one row whole. Through Prisma, which leaves the geography
 * columns out - they're megabytes of coordinates, not something to read on a page.
 */

type Db = ManageService['db'];

export const PAGE_SIZE = 50;

export interface TableSummary {
	rows: number;
	lastUpdated: Date | null;
}

export interface CategoryCount {
	/** Null for rows with no category. */
	category: string | null;
	rows: number;
}

export interface DatabaseOverview {
	consulteeAreas: TableSummary;
	caseBoundaries: TableSummary;
	categories: CategoryCount[];
}

export async function databaseOverview(db: Db): Promise<DatabaseOverview> {
	const [consulteeAreas, consulteeAreasUpdated, caseBoundaries, caseBoundariesUpdated, categories] = await Promise.all([
		db.consulteeArea.count(),
		db.consulteeArea.aggregate({ _max: { lastUpdated: true } }),
		db.caseBoundary.count(),
		db.caseBoundary.aggregate({ _max: { lastUpdated: true } }),
		db.consulteeArea.groupBy({
			by: ['consulteeCategory'],
			_count: { _all: true },
			orderBy: { consulteeCategory: 'asc' }
		})
	]);
	return {
		consulteeAreas: { rows: consulteeAreas, lastUpdated: consulteeAreasUpdated._max.lastUpdated },
		caseBoundaries: { rows: caseBoundaries, lastUpdated: caseBoundariesUpdated._max.lastUpdated },
		categories: categories.map((group) => ({ category: group.consulteeCategory, rows: group._count._all }))
	};
}

/** A page of rows and how many there are in all. */
export interface RowPage<Row> {
	rows: Row[];
	total: number;
}

export interface ConsulteeAreaFilter {
	/** A category, exactly - empty for every category. */
	category: string;
	/** Part of a consultee's name - empty for every consultee. */
	search: string;
	page: number;
}

export interface ConsulteeAreaListRow {
	id: string;
	consulteeCategory: string | null;
	consultee: string | null;
	region: string | null;
	geometryType: string;
	lastUpdated: Date;
}

export async function listConsulteeAreaRows(
	db: Db,
	{ category, search, page }: ConsulteeAreaFilter
): Promise<RowPage<ConsulteeAreaListRow>> {
	const where = {
		...(category ? { consulteeCategory: category } : {}),
		...(search ? { consultee: { contains: search } } : {})
	};
	const [rows, total] = await Promise.all([
		db.consulteeArea.findMany({
			where,
			select: {
				id: true,
				consulteeCategory: true,
				consultee: true,
				region: true,
				geometryType: true,
				lastUpdated: true
			},
			orderBy: [{ consulteeCategory: 'asc' }, { consultee: 'asc' }, { id: 'asc' }],
			skip: (page - 1) * PAGE_SIZE,
			take: PAGE_SIZE
		}),
		db.consulteeArea.count({ where })
	]);
	return { rows, total };
}

export interface CaseBoundaryFilter {
	/** Part of a case reference or name - empty for every case. */
	search: string;
	page: number;
}

export interface CaseBoundaryListRow {
	id: string;
	caseReference: string;
	caseName: string;
	fileName: string | null;
	receivedDate: Date | null;
	geometryType: string;
}

export async function listCaseBoundaryRows(
	db: Db,
	{ search, page }: CaseBoundaryFilter
): Promise<RowPage<CaseBoundaryListRow>> {
	const where = search ? { OR: [{ caseReference: { contains: search } }, { caseName: { contains: search } }] } : {};
	const [rows, total] = await Promise.all([
		db.caseBoundary.findMany({
			where,
			select: {
				id: true,
				caseReference: true,
				caseName: true,
				fileName: true,
				receivedDate: true,
				geometryType: true
			},
			orderBy: [{ caseReference: 'asc' }, { receivedDate: 'desc' }, { id: 'asc' }],
			skip: (page - 1) * PAGE_SIZE,
			take: PAGE_SIZE
		}),
		db.caseBoundary.count({ where })
	]);
	return { rows, total };
}

/** Every column of one consultee area but its geometries, or null when there's no such row. */
export function consulteeAreaRow(db: Db, id: string) {
	return db.consulteeArea.findUnique({ where: { id } });
}

/** Every column of one case boundary but its geometry, or null when there's no such row. */
export function caseBoundaryRow(db: Db, id: string) {
	return db.caseBoundary.findUnique({ where: { id } });
}
