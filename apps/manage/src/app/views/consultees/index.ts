import type { ManageService } from '#service';
import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import { buildConsulteeProjectPage } from './project/controller.ts';
import { buildReportConsulteeAddPage, buildReportConsulteeAddSubmit } from './report/consultees/add/controller.ts';
import { buildReportConsulteesPage } from './report/consultees/controller.ts';
import { buildReportCheckPage, buildReportCreatedPage } from './report/controller.ts';
import { buildConsulteesResultsPage, buildResultsStaticMap } from './results/controller.ts';
import { buildRulesetPickerPage, buildRulesetPickerSubmit } from './ruleset/controller.ts';
import { buildShapefilePickerPage, buildShapefilePickerSubmit } from './shapefile/controller.ts';

export function createRoutes(service: ManageService): IRouter {
	const router = createRouter({ mergeParams: true });
	const projectPage = buildConsulteeProjectPage(service);
	const rulesetPickerPage = buildRulesetPickerPage(service);
	const rulesetPickerSubmit = buildRulesetPickerSubmit();
	const shapefilePickerPage = buildShapefilePickerPage(service);
	const shapefilePickerSubmit = buildShapefilePickerSubmit(service);
	const reportCheckPage = buildReportCheckPage(service);
	const reportConsulteesPage = buildReportConsulteesPage(service);
	const reportConsulteeAddPage = buildReportConsulteeAddPage(service);
	const reportConsulteeAddSubmit = buildReportConsulteeAddSubmit(service);
	const reportCreatedPage = buildReportCreatedPage(service);
	const resultsPage = buildConsulteesResultsPage(service);
	const resultsStaticMap = buildResultsStaticMap(service);
	const resultsStaticMapSvg = buildResultsStaticMap(service, true);

	// the project's map page - where the home page's project links land
	router.get('/:caseId', asyncHandler(projectPage));
	// its two "Change" pages, which post back and return to the map page
	router.get('/:caseId/ruleset', asyncHandler(rulesetPickerPage));
	router.post('/:caseId/ruleset', asyncHandler(rulesetPickerSubmit));
	router.get('/:caseId/shapefile', asyncHandler(shapefilePickerPage));
	router.post('/:caseId/shapefile', asyncHandler(shapefilePickerSubmit));
	// "Preview report": check the identified consultees before generating the report
	router.get('/:caseId/report', asyncHandler(reportCheckPage));
	// each identified category's "Change" page - remove consultees, save and return to the check page
	router.get('/:caseId/report/consultees', asyncHandler(reportConsulteesPage));
	// its "Add consultee" form - adds a consultee to the category and returns to the Change page
	router.get('/:caseId/report/consultees/add', asyncHandler(reportConsulteeAddPage));
	router.post('/:caseId/report/consultees/add', asyncHandler(reportConsulteeAddSubmit));
	// "Generate report": confirmation page with the report download link (a placeholder for now)
	router.get('/:caseId/report/created', asyncHandler(reportCreatedPage));
	// the consultee report (tables) for the current shapefile/ruleset selection
	router.get('/:caseId/results/static-map.svg', asyncHandler(resultsStaticMapSvg));
	router.get('/:caseId/results/static-map', asyncHandler(resultsStaticMap));
	router.get('/:caseId/results', asyncHandler(resultsPage));

	return router;
}
