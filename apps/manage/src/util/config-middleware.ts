import type { Handler } from 'express';

/**
 * Add configuration values to locals.
 */
export function addLocalsConfiguration(): Handler {
	return (req, res, next) => {
		res.locals.config = {
			styleFile: 'style-3639132e.css',
			headerTitle: 'Identify consultees',
			footerLinks: []
		};
		next();
	};
}
