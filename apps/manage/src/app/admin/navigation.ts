/** An admin page: where it is, what the menu calls it, and what the admin home says it's for. */
export interface AdminPage {
	href: string;
	text: string;
	description: string;
}

/** Every admin page, in menu order - add a page here and to index.ts to put it in the menu. */
export const ADMIN_PAGES: readonly AdminPage[] = [
	{ href: '/admin', text: 'Overview', description: 'Every admin page.' },
	{
		href: '/admin/database',
		text: 'Database',
		description: "What's loaded: each table's rows, the consultee areas by category, and every column of a row."
	},
	{
		href: '/admin/upload-to-blob',
		text: 'Upload to blob storage',
		description: 'Upload a reference data or case boundary file to this environment’s blob storage.'
	},
	{
		href: '/admin/import-reference-data',
		text: 'Import reference data',
		description: 'Replace the consultee areas or case boundaries with a file uploaded to blob storage.'
	},
	{
		href: '/admin/import-from-cbos',
		text: 'Import cases from CBOS',
		description: 'How many cases are in the database, and import every case boundary CBOS holds.'
	}
];

/** One menu entry, current when the request is for its page (or, but for Overview, one beneath it). */
export interface AdminNavItem {
	href: string;
	text: string;
	current: boolean;
}

/** The admin menu for a request path. */
export function adminNavigation(path: string): AdminNavItem[] {
	const normalised = path.replace(/\/+$/, '') || '/';
	return ADMIN_PAGES.map(({ href, text }) => ({
		href,
		text,
		current: href === '/admin' ? normalised === href : normalised === href || normalised.startsWith(`${href}/`)
	}));
}
