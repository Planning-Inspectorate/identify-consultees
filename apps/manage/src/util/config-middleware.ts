import type { Handler } from 'express';

/**
 * Add configuration values to locals.
 * Asset filenames are rewritten by `npm run build` (content hash + Brotli pipeline).
 */
export function addLocalsConfiguration(): Handler {
	return (req, res, next) => {
		res.locals.config = {
			styleFile: 'style-635ae645.css',
			govukFrontendJs: 'assets/js/govuk-frontend.min-38b6270a.js',
			consulteesMapJs: 'javascripts/consultees-map-edecec94.js',
			accessibleAutocompleteJs: 'assets/js/accessible-autocomplete.min-5e8c6959.js',
			accessibleAutocompleteCss: 'assets/css/accessible-autocomplete.min-08028661.css',
			headerTitle: 'Identify consultees',
			footerLinks: []
		};
		next();
	};
}
