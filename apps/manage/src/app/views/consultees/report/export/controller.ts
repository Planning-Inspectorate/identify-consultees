import type { ManageService } from '#service';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { resolveCase } from '../../resolve-case.ts';
import { requestedRuleset, runRulesetSafely } from '../../run-ruleset.ts';
import { consulteeSelection, reportCreatedUrl, reportDownloadUrl } from '../urls.ts';
import { buildReportZip, rememberedReportZip } from './report-zip.ts';

/**
 * The Report created page's download: the ZIP the created page built (an Excel workbook and a PDF
 * of each category's map - see report-zip.ts), kept in memory under this URL so the link can give
 * the file's size and the download serves without rebuilding. A restart or expiry, or a hit with
 * no page visit first, builds it here instead - from the run the report pages kept in the session
 * (see runRulesetSafely), so the ruleset only runs again if that has gone; nothing is written to
 * disk or the session. If the ruleset can't be run, or the report can't be built, it goes back to
 * the Report created page, which says so and offers to retry the download.
 */
export function buildReportDownload(service: ManageService): AsyncRequestHandler {
	const { db, logger } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const project = await resolveCase(db, caseId);
		const ruleset = requestedRuleset(req.query?.ruleset);
		if (!project || !ruleset) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		const selection = consulteeSelection(req.query);
		const downloadUrl = reportDownloadUrl(project.id, ruleset.id, selection);

		const remembered = rememberedReportZip(downloadUrl);
		if (remembered) {
			logger.info({ caseId: project.id, rulesetId: ruleset.id }, 'consultee report download (as built)');
			res.set({
				'Content-Type': 'application/zip',
				'Content-Disposition': `attachment; filename="${remembered.fileName}"`
			});
			res.send(remembered.contents);
			return;
		}

		const { consultees, failed, siteScreenedAs } = await runRulesetSafely(service, project, ruleset, req.session);
		if (failed) {
			res.redirect(reportCreatedUrl(project.id, ruleset.id, selection));
			return;
		}

		let report;
		try {
			report = await buildReportZip({ service, project, ruleset, consultees, selection, siteScreenedAs });
		} catch (error) {
			logger.error({ error, caseId: project.id, rulesetId: ruleset.id }, 'Failed to build the report ZIP for download');
			res.redirect(`${reportCreatedUrl(project.id, ruleset.id, selection)}&download=failed`);
			return;
		}
		res.set({
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${report.fileName}"`
		});
		res.send(report.contents);
	};
}
