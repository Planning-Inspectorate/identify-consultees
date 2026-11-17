import type { ManageService } from '#service';
import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import { buildEndpointRateLimiter } from '../../rate-limit.ts';
import { buildBoundaryStaticMap, buildBoundarySubmit, buildConsulteeProjectPage } from './project/controller.ts';
import {
	buildReportConsulteeAddPage,
	buildReportConsulteeAddSubmit,
	buildReportConsulteeAddSuggestions
} from './report/consultees/add/controller.ts';
import { buildReportConsulteesPage } from './report/consultees/controller.ts';
import {
	buildReportConsulteeRemovePage,
	buildReportConsulteeRemoveSubmit
} from './report/consultees/remove/controller.ts';
import { buildReportCheckPage, buildReportCreatedPage } from './report/controller.ts';
import { buildReportDownload } from './report/export/controller.ts';
import { buildResultsStaticMap } from './results/controller.ts';
import { buildRulesetPickerPage, buildRulesetPickerSubmit } from './ruleset/controller.ts';

export function createRoutes(service: ManageService): IRouter {
	const router = createRouter({ mergeParams: true });
	const projectPage = buildConsulteeProjectPage(service);
	const boundarySubmit = buildBoundarySubmit(service);
	const boundaryStaticMap = buildBoundaryStaticMap(service);
	const boundaryStaticMapSvg = buildBoundaryStaticMap(service, true);
	const rulesetPickerPage = buildRulesetPickerPage(service);
	const rulesetPickerSubmit = buildRulesetPickerSubmit(service);
	const reportCheckPage = buildReportCheckPage(service);
	const reportConsulteesPage = buildReportConsulteesPage(service);
	const reportConsulteeAddPage = buildReportConsulteeAddPage(service);
	const reportConsulteeAddSubmit = buildReportConsulteeAddSubmit(service);
	const reportConsulteeAddSuggestions = buildReportConsulteeAddSuggestions(service);
	const reportConsulteeRemovePage = buildReportConsulteeRemovePage(service);
	const reportConsulteeRemoveSubmit = buildReportConsulteeRemoveSubmit(service);
	const reportCreatedPage = buildReportCreatedPage(service);
	const reportDownload = buildReportDownload(service);
	const resultsStaticMap = buildResultsStaticMap(service);
	const resultsStaticMapSvg = buildResultsStaticMap(service, true);

	// the heavy routes - the map renders, the ruleset run and its report download - each get their
	// own rate-limiter bucket per client (a fresh limiter each, not one shared across the routes).
	// The suggestions lookup stays unlimited: it fires a light query per keystroke
	const heavy = () => buildEndpointRateLimiter();

	// the project boundary page - where the home page's project links land; its map draws every
	// shapefile the case holds, and its radios confirm the one carried into the report
	router.get('/:caseId/boundary-map.svg', heavy(), asyncHandler(boundaryStaticMapSvg));
	router.get('/:caseId/boundary-map', heavy(), asyncHandler(boundaryStaticMap));
	router.get('/:caseId', asyncHandler(projectPage));
	router.post('/:caseId', heavy(), asyncHandler(boundarySubmit));
	// pick the ruleset the report is generated with, then on to the check page
	router.get('/:caseId/ruleset', asyncHandler(rulesetPickerPage));
	router.post('/:caseId/ruleset', asyncHandler(rulesetPickerSubmit));
	// "Identify consultees": check the identified consultees before generating the report
	router.get('/:caseId/report', heavy(), asyncHandler(reportCheckPage));
	// each identified category's "Change" page - remove consultees, save and return to the check page
	router.get('/:caseId/report/consultees', heavy(), asyncHandler(reportConsulteesPage));
	// its "Add a consultee" page - adds a consultee to the category and returns to the Change page
	router.get('/:caseId/report/consultees/add', asyncHandler(reportConsulteeAddPage));
	router.post('/:caseId/report/consultees/add', heavy(), asyncHandler(reportConsulteeAddSubmit));
	// its suggestions as a name is typed, from the whole of the category's reference data
	router.get('/:caseId/report/consultees/add/suggestions', asyncHandler(reportConsulteeAddSuggestions));
	// its "Remove consultee" form - records the removal reason and returns to the Change page
	router.get('/:caseId/report/consultees/remove', asyncHandler(reportConsulteeRemovePage));
	router.post('/:caseId/report/consultees/remove', heavy(), asyncHandler(reportConsulteeRemoveSubmit));
	// "Create report": confirmation page with the report download link
	router.get('/:caseId/report/created', heavy(), asyncHandler(reportCreatedPage));
	router.get('/:caseId/report/download', heavy(), asyncHandler(reportDownload));
	// a category page's static map (see categoryStaticMapUrl)
	router.get('/:caseId/results/static-map.svg', heavy(), asyncHandler(resultsStaticMapSvg));
	router.get('/:caseId/results/static-map', heavy(), asyncHandler(resultsStaticMap));

	return router;
}
