export interface PaginationItem {
	number?: number;
	href?: string;
	current?: boolean;
	ellipsis?: boolean;
}

export interface PaginationViewModel {
	previous?: { href: string };
	next?: { href: string };
	items: PaginationItem[];
}

const ELLIPSIS = 'ellipsis' as const;

/**
 * Which page numbers the pagination component lists, matching the GOV.UK pagination examples:
 * every page when there are only a few, otherwise the first and last pages plus the current page
 * and its immediate neighbours, joined by ellipses.
 */
function visiblePages(page: number, totalPages: number): (number | typeof ELLIPSIS)[] {
	if (totalPages <= 7) {
		return Array.from({ length: totalPages }, (_, i) => i + 1);
	}
	if (page <= 4) {
		return [1, 2, 3, 4, 5, ELLIPSIS, totalPages];
	}
	if (page >= totalPages - 3) {
		return [1, ELLIPSIS, totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
	}
	return [1, ELLIPSIS, page - 1, page, page + 1, ELLIPSIS, totalPages];
}

/**
 * Build the model for the govukPagination macro. Returns null when there is only one page (or no
 * results), so callers can skip rendering pagination entirely.
 */
export function buildPagination(
	page: number,
	totalPages: number,
	hrefForPage: (page: number) => string
): PaginationViewModel | null {
	if (totalPages <= 1) {
		return null;
	}

	const items: PaginationItem[] = visiblePages(page, totalPages).map((entry) =>
		entry === ELLIPSIS ? { ellipsis: true } : { number: entry, href: hrefForPage(entry), current: entry === page }
	);

	return {
		previous: page > 1 ? { href: hrefForPage(page - 1) } : undefined,
		next: page < totalPages ? { href: hrefForPage(page + 1) } : undefined,
		items
	};
}
