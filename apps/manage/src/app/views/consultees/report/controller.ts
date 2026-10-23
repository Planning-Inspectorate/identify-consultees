import type { ManageService } from '#service';
import type { ConsulteeMatch, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { isIdentified } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { NEARBY_NSIPS } from '../nearby-nsips.ts';
import { resolveCase } from '../resolve-case.ts';
import { firstQueryValue, requestedRuleset, runRulesetSafely } from '../run-ruleset.ts';
import { reportCategories } from './categories.ts';
import { buildReportZip, formatFileSize, rememberedReportZip, rememberReportZip } from './export/report-zip.ts';
import { GROUP_TABS, tabForCategory } from './export/workbook.ts';
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
import type {
	ConsulteeGroup,
	IdentifiedConsultee,
	ReportCheckViewModel,
	ReportCreatedViewModel
} from './view-model.ts';

/**
 * Every category the ruleset covers, in the order its rules name them, then any other category its
 * conditions identified consultees in (see reportCategories), then Nearby NSIPs when they're looked
 * for (`nearbyNsips`) - found or not, as a covered category is - bucketed into the export workbook's
 * group tabs (export/workbook.ts's tabForCategory) so the page's sections match the report.
 * Consultees only the nearby search found aren't counted: they're map context, not report
 * content - including covered categories that matched nothing, so the list reads as the
 * ruleset's full coverage. Excluded consultees (removed on a category's Change page) don't
 * appear and hand-added ones do. Groups with no categories at all are left out.
 */
export function groupedConsultees(
	ruleset: Ruleset,
	caseId: string,
	matches: ConsulteeMatch[],
	selection: ConsulteeSelection,
	nearbyNsips = false
): ConsulteeGroup[] {
	const names = new Map<string, string[]>();
	const excluded = excludedMatchIds(selection.removed);
	const identified = matches.filter(isIdentified);
	for (const match of identified) {
		const category = match.feature.properties.consulteeCategory;
		if (category && !excluded.has(match.feature.id)) {
			names.set(category, [...(names.get(category) ?? []), consulteeName(match)]);
		}
	}
	for (const add of selection.adds) {
		names.set(add.category, [...(names.get(add.category) ?? []), add.name]);
	}
	const row = (category: string): IdentifiedConsultee => ({
		name: category,
		names: names.get(category) ?? [],
		changeUrl: consulteesUrl(caseId, ruleset.id, category, selection)
	});
	const byGroup = new Map<string, IdentifiedConsultee[]>();
	const categories = reportCategories(ruleset, identified);
	if (nearbyNsips && !categories.includes(NEARBY_NSIPS)) {
		categories.push(NEARBY_NSIPS);
	}
	for (const category of categories) {
		const group = tabForCategory(category, ruleset);
		byGroup.set(group, [...(byGroup.get(group) ?? []), row(category)]);
	}
	return GROUP_TABS.map((tab) => ({ name: tab, consultees: byGroup.get(tab) ?? [] })).filter(
		(group) => group.consultees.length > 0
	);
}

/**
 * The map page's "Preview report" destination: check the consultees the selected ruleset
 * identified before generating the report. Shows the report's details (case, stage, ruleset)
 * and the per-category match counts. "Generate report" leads to the Report created page.
 */
export function buildReportCheckPage(service: ManageService): AsyncRequestHandler {
	const { db, logger } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const project = await resolveCase(db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		const ruleset = requestedRuleset(req.query?.ruleset);
		if (!ruleset) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		logger.info(
			{ caseId, reference: project.properties.caseReference, rulesetId: ruleset.id },
			'consultee report check page'
		);

		const { consultees, failed, siteScreenedAs } = await runRulesetSafely(service, project, ruleset, req.session);
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
			groups: groupedConsultees(ruleset, project.id, consultees, selection, service.nearbyNsipRadiusMetres > 0),
			generateReportUrl: reportCreatedUrl(project.id, ruleset.id, selection),
			rulesetFailed: failed,
			retryUrl: reportUrl(project.id, ruleset.id, selection),
			screenedBoundingBox: siteScreenedAs === 'boundingBox'
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
	const { db, logger } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const project = await resolveCase(db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		const ruleset = requestedRuleset(req.query?.ruleset);
		if (!ruleset) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		const selection: ConsulteeSelection = consulteeSelection(req.query);
		const downloadUrl = reportDownloadUrl(project.id, ruleset.id, selection);
		const { consultees, failed, siteScreenedAs } = await runRulesetSafely(service, project, ruleset, req.session);

		let downloadSize = '';
		if (!failed) {
			try {
				const report =
					rememberedReportZip(downloadUrl) ??
					(await buildReportZip({ service, project, ruleset, consultees, selection, siteScreenedAs }));
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
			retryUrl: reportCreatedUrl(project.id, ruleset.id, selection),
			// the download sends them back here with ?download=failed when the report can't be built
			downloadFailed: firstQueryValue(req.query.download) === 'failed'
		};
		return res.render('views/consultees/report/created.njk', viewModel);
	};
}
