import type { ManageService } from '#service';
import type { ConsulteeMatch, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import {
	getRuleset,
	isIdentifiedByCondition,
	RULESETS
} from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { resolveCase } from '../resolve-case.ts';
import { firstQueryValue, runRulesetSafely } from '../run-ruleset.ts';
import { reportCategories } from './categories.ts';
import { buildReportZip, formatFileSize, rememberedReportZip, rememberReportZip } from './export/report-zip.ts';
import { consulteeName } from './report-consultees.ts';
import type { ConsulteeSelection } from './urls.ts';
import {
	consulteeSelection,
	consulteesUrl,
	excludedMatchIds,
	reportCreatedUrl,
	reportDownloadUrl,
	reportUrl,
	rulesetUrl
} from './urls.ts';
import type { IdentifiedConsultee, ReportCheckViewModel, ReportCreatedViewModel } from './view-model.ts';

// the check page lists consultee names per category, capped - seeing or removing the rest is
// what each category's Change page is for
const MAX_LISTED_CONSULTEES = 10;

/**
 * Every category the ruleset covers, in the order its rules name them, then any other category its
 * conditions identified consultees in (see reportCategories), with each one's visible consultee names.
 * Consultees only the nearby search found aren't counted: they're map context, not report content - including covered
 * categories that matched nothing, so the list reads as the ruleset's full coverage. Excluded
 * consultees (removed on a category's Change page) don't appear and hand-added ones do - the
 * total here is the number of rows that page lists. Categories bigger than MAX_LISTED_CONSULTEES
 * name only the first few, with the total alongside.
 */
function identifiedConsultees(
	ruleset: Ruleset,
	caseId: string,
	matches: ConsulteeMatch[],
	selection: ConsulteeSelection
): IdentifiedConsultee[] {
	const names = new Map<string, string[]>();
	const excluded = excludedMatchIds(selection.removed);
	const identified = matches.filter(isIdentifiedByCondition);
	for (const match of identified) {
		const category = match.feature.properties.consulteeCategory;
		if (category && !excluded.has(match.feature.id)) {
			names.set(category, [...(names.get(category) ?? []), consulteeName(match)]);
		}
	}
	for (const add of selection.adds) {
		names.set(add.category, [...(names.get(add.category) ?? []), add.name]);
	}
	return reportCategories(ruleset, identified).map((name) => {
		const categoryNames = names.get(name) ?? [];
		return {
			name,
			names: categoryNames.slice(0, MAX_LISTED_CONSULTEES),
			total: categoryNames.length,
			changeUrl: consulteesUrl(caseId, ruleset.id, name, selection)
		};
	});
}

/**
 * The map page's "Preview report" destination: check the consultees the selected ruleset
 * identified before generating the report. Shows the report's details (case, stage, ruleset)
 * and the per-category match counts. "Generate report" leads to the Report created page.
 */
export function buildReportCheckPage(service: ManageService): AsyncRequestHandler {
	const { db, logger, nearbyConsulteeRadiusMetres, rulesetRunner } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const project = await resolveCase(db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		// same ruleset semantics as the map page: absent means the default, present-but-unknown 404s
		const requestedRuleset = firstQueryValue(req.query?.ruleset);
		const ruleset = requestedRuleset ? getRuleset(requestedRuleset) : RULESETS[0];
		if (!ruleset) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		logger.info(
			{ caseId, reference: project.properties.caseReference, rulesetId: ruleset.id },
			'consultee report check page'
		);

		const { consultees, failed } = await runRulesetSafely(
			rulesetRunner,
			project,
			ruleset,
			nearbyConsulteeRadiusMetres,
			logger,
			req.session
		);
		const selection: ConsulteeSelection = consulteeSelection(req.query);

		const viewModel: ReportCheckViewModel = {
			pageHeading: 'Check consultees before creating the report',
			backLinkUrl: rulesetUrl(project.id, ruleset.id, selection),
			caseName: project.properties.caseName,
			reference: project.properties.caseReference,
			// changing the project means picking a different one - back to the search
			caseChangeUrl: '/',
			shapefileName: project.properties.fileName ?? 'Not provided',
			// changing the shapefile means re-confirming the boundary - back to the map page
			shapefileChangeUrl: `/consultees/${encodeURIComponent(project.id)}`,
			rulesetName: ruleset.name,
			rulesetChangeUrl: rulesetUrl(project.id, ruleset.id, selection),
			consultees: identifiedConsultees(ruleset, project.id, consultees, selection),
			generateReportUrl: reportCreatedUrl(project.id, ruleset.id, selection),
			rulesetFailed: failed,
			retryUrl: reportUrl(project.id, ruleset.id, selection)
		};

		return res.render('views/consultees/report/view.njk', viewModel);
	};
}

/**
 * "Create report" lands here: a confirmation naming the case and a link to download the report -
 * an Excel workbook and a PDF of each category's map, in a ZIP. The ZIP is built here so the link
 * can give its size, and kept for the download to serve (see export/report-zip.ts); if it can't be
 * built the page still renders, the link just says "(ZIP)" and the download builds it when clicked.
 */
export function buildReportCreatedPage(service: ManageService): AsyncRequestHandler {
	const { db, logger, nearbyConsulteeRadiusMetres, rulesetRunner } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const project = await resolveCase(db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		// same ruleset semantics as the map page: absent means the default, present-but-unknown 404s
		const requestedRuleset = firstQueryValue(req.query?.ruleset);
		const ruleset = requestedRuleset ? getRuleset(requestedRuleset) : RULESETS[0];
		if (!ruleset) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		const selection: ConsulteeSelection = consulteeSelection(req.query);
		const downloadUrl = reportDownloadUrl(project.id, ruleset.id, selection);
		const { consultees, failed } = await runRulesetSafely(
			rulesetRunner,
			project,
			ruleset,
			nearbyConsulteeRadiusMetres,
			logger,
			req.session
		);

		let downloadSize = '';
		if (!failed) {
			try {
				const report =
					rememberedReportZip(downloadUrl) ??
					(await buildReportZip({ service, project, ruleset, consultees, selection }));
				rememberReportZip(downloadUrl, report);
				downloadSize = formatFileSize(report.contents.length);
			} catch (error) {
				logger.error({ error, caseId: project.id, rulesetId: ruleset.id }, 'Failed to build the report ZIP');
			}
		}

		const viewModel: ReportCreatedViewModel = {
			pageHeading: 'Report created',
			backLinkUrl: reportUrl(project.id, ruleset.id, selection),
			caseName: project.properties.caseName,
			reference: project.properties.caseReference,
			downloadUrl,
			downloadText: `Download ${project.properties.caseName} Consultee List report (ZIP${downloadSize ? `, ${downloadSize}` : ''})`,
			rulesetFailed: failed,
			retryUrl: reportCreatedUrl(project.id, ruleset.id, selection)
		};
		return res.render('views/consultees/report/created.njk', viewModel);
	};
}
