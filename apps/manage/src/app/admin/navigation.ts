/** An admin page: where it is, what the menu calls it, and what the admin home says it's for. */
export interface AdminPage {
	href: string;
	text: string;
	description: string;
}

const OVERVIEW: AdminPage = { href: '/admin', text: 'Overview', description: 'Every admin page.' };
const DATABASE: AdminPage = {
	href: '/admin/database',
	text: 'Database',
	description: "What's loaded: each table's rows, the consultee areas by category, and every column of a row."
};
const FILES: AdminPage = {
	href: '/admin/upload-to-blob',
	text: 'Reference data files',
	description: 'Upload a group’s file to blob storage.'
};
const LOAD: AdminPage = {
	href: '/admin/import-reference-data',
	text: 'Load into database',
	description: 'Load each group’s file into the consultee areas, and see each quarter’s dataset.'
};
// the load page, where the reference data can't be changed: what's in blob storage and loaded
const REFERENCE_DATA: AdminPage = {
	href: '/admin/import-reference-data',
	text: 'Reference data',
	description: 'What’s in blob storage and loaded: each group’s newest file and rows, and each quarter’s dataset.'
};

/**
 * Every admin page, in menu order - add a page here and to index.ts to put it in the menu. Where
 * the reference data can't be changed (Training and Prod - see config.ts's referenceDataChanges)
 * there's no files page, and the load page only reports, as Reference data.
 */
export function adminPages(referenceDataChanges: boolean): AdminPage[] {
	return [OVERVIEW, DATABASE, ...(referenceDataChanges ? [FILES, LOAD] : [REFERENCE_DATA])];
}

/** One menu entry, current when the request is for its page (or, but for Overview, one beneath it). */
export interface AdminNavItem {
	href: string;
	text: string;
	current: boolean;
}

/** The admin menu of `pages` for a request path. */
export function adminNavigation(path: string, pages: readonly AdminPage[]): AdminNavItem[] {
	const normalised = path.replace(/\/+$/, '') || '/';
	return pages.map(({ href, text }) => ({
		href,
		text,
		current: href === '/admin' ? normalised === href : normalised === href || normalised.startsWith(`${href}/`)
	}));
}
