import type { ManageService } from '#service';
import type { ConsulteeAreaMatch } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import type { Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { getRuleset, RULESETS } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { resolveCase, resolveCaseSummary } from '../resolve-case.ts';
import { firstQueryValue, projectPageUrl, runRulesetSafely } from '../run-ruleset.ts';
import type { IdentifiedConsultee, ReportCheckViewModel } from './view-model.ts';

/**
 * Every category the ruleset covers, in the order its rules name them, with each one's match
 * count - including categories that matched nothing, so the list reads as the ruleset's full
 * coverage rather than just what happened to hit.
 */
function identifiedConsultees(ruleset: Ruleset, matches: ConsulteeAreaMatch[]): IdentifiedConsultee[] {
	const categories = [...new Set(ruleset.rules.flatMap((rule) => rule.categories))];
	const counts = new Map<string, number>();
	for (const match of matches) {
		const category = match.feature.properties.consulteeCategory;
		if (category) {
			counts.set(category, (counts.get(category) ?? 0) + 1);
		}
	}
	// per-category Change links are placeholders until consultee selection exists
	return categories.map((name) => ({ name, count: String(counts.get(name) ?? 0), changeUrl: '#' }));
}

/**
 * The map page's "Preview report" destination: check the consultees the selected ruleset
 * identified before generating the report. Shows the report's details (case, stage, ruleset)
 * and the per-category match counts. "Generate report" is a placeholder - report generation
 * doesn't exist yet.
 */
export function buildReportCheckPage(service: ManageService): AsyncRequestHandler {
	const { db, logger, nearbyConsulteeRadiusMetres } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const project = await resolveCase(db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		// same ruleset semantics as the map page: absent means the default, present-but-unknown 404s
		const requestedRuleset = firstQueryValue(req.query.ruleset);
		const ruleset = requestedRuleset ? getRuleset(requestedRuleset) : RULESETS[0];
		if (!ruleset) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		logger.info(
			{ caseId, reference: project.properties.caseReference, rulesetId: ruleset.id },
			'consultee report check page'
		);

		const { matches, failed } = await runRulesetSafely(db, project, ruleset, nearbyConsulteeRadiusMetres, logger);

		const viewModel: ReportCheckViewModel = {
			pageHeading: 'Check consultees before creating the report',
			backLinkUrl: projectPageUrl(project.id, ruleset.id),
			caseName: project.properties.caseName,
			reference: project.properties.caseReference,
			stage: project.properties.acceptance ?? null,
			// changing the case means picking a different project - back to the search
			caseChangeUrl: '/',
			rulesetName: ruleset.name,
			rulesetChangeUrl: `/consultees/${encodeURIComponent(project.id)}/ruleset?ruleset=${encodeURIComponent(ruleset.id)}`,
			consultees: identifiedConsultees(ruleset, matches),
			generateReportUrl: `/consultees/${encodeURIComponent(project.id)}/report/created?ruleset=${encodeURIComponent(ruleset.id)}`,
			rulesetFailed: failed,
			retryUrl: projectPageUrl(project.id, ruleset.id)
		};

		return res.render('views/consultees/report/view.njk', viewModel);
	};
}

/**
 * "Generate report" lands here: a confirmation panel naming the case and a download link. Report
 * generation itself doesn't exist yet, so the download link is a placeholder.
 */
export function buildReportCreatedPage(service: ManageService): AsyncRequestHandler {
	const { db } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const project = await resolveCaseSummary(db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		// same ruleset semantics as the map page: absent means the default, present-but-unknown 404s
		const requestedRuleset = firstQueryValue(req.query.ruleset);
		const ruleset = requestedRuleset ? getRuleset(requestedRuleset) : RULESETS[0];
		if (!ruleset) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		return res.render('views/consultees/report/created.njk', {
			pageHeading: 'Report created',
			backLinkUrl: projectPageUrl(project.id, ruleset.id),
			caseName: project.caseName,
			reference: project.reference,
			// placeholder until report generation exists - there is no file to link to yet
			downloadUrl: '#',
			downloadText: `Download ${project.caseName} scoping report (ZIP)`
		});
	};
}
