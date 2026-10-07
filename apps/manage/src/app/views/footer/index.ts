import type { IRouter } from 'express';
import { Router as createRouter } from 'express';

// the site footer's support links - static content pages with the same headings as the links
const PAGES = [
	{ path: '/terms-and-conditions', view: 'views/footer/terms-and-conditions.njk', pageHeading: 'Terms and conditions' },
	{
		path: '/accessibility-statement',
		view: 'views/footer/accessibility-statement.njk',
		pageHeading: 'Accessibility statement for Identify consultees'
	},
	{ path: '/privacy', view: 'views/footer/privacy.njk', pageHeading: 'Privacy notice' },
	{ path: '/cookies', view: 'views/footer/cookies.njk', pageHeading: 'Cookies' },
	{ path: '/contact', view: 'views/footer/contact.njk', pageHeading: 'Contact us' }
];

/**
 * The site's footer pages. Mounted before the auth guard so the accessibility statement and
 * other policy pages are readable without signing in, matching how PINS's public services treat
 * them.
 */
export function createFooterRoutes(): IRouter {
	const router = createRouter({ mergeParams: true });
	for (const page of PAGES) {
		router.get(page.path, (_req, res) => res.render(page.view, { pageHeading: page.pageHeading }));
	}
	return router;
}
