import type { ManageService } from '#service';
import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import { buildConsulteesResultsPage, buildResultsStaticMap } from './results/controller.ts';
import { buildRulesetPickerPage } from './ruleset/controller.ts';

export function createRoutes(service: ManageService): IRouter {
	const router = createRouter({ mergeParams: true });
	const rulesetPickerPage = buildRulesetPickerPage(service);
	const resultsPage = buildConsulteesResultsPage(service);
	const resultsStaticMap = buildResultsStaticMap(service);
	const resultsStaticMapSvg = buildResultsStaticMap(service, true);

	// step 2: pick a ruleset for the project chosen on the home page
	router.get('/:caseId', asyncHandler(rulesetPickerPage));
	// step 3: run it and show the matching consultees
	router.get('/:caseId/results/static-map.svg', asyncHandler(resultsStaticMapSvg));
	router.get('/:caseId/results/static-map', asyncHandler(resultsStaticMap));
	router.get('/:caseId/results', asyncHandler(resultsPage));

	return router;
}
