import { acceptedConsulteeTypes } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';

export const HELP_PAGE_HEADING = 'How to use Identify consultees';

/**
 * The help page's view model: the accepted Consultee Type(s) wordings come from
 * config/rulesets/rulesets.yaml, so the list can't fall out of step with what the rulesets accept.
 */
export function helpViewModel() {
	const types = acceptedConsulteeTypes();
	return {
		pageHeading: HELP_PAGE_HEADING,
		consulteeTypeWordings: types.map(({ wording }) => wording),
		awaitingDataWordings: types.filter(({ awaitingData }) => awaitingData).map(({ wording }) => wording)
	};
}

/**
 * The service's user guide: the journey, the report pack, and how rulesets are changed. Behind
 * sign-in, unlike the footer's policy pages, because it describes how rulesets are changed.
 */
export function createRoutes(): IRouter {
	const router = createRouter({ mergeParams: true });
	const viewModel = helpViewModel();
	router.get('/', (_req, res) => res.render('views/help/view.njk', viewModel));
	return router;
}
