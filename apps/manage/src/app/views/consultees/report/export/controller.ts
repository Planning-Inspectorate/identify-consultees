import type { ManageService } from '#service';
import {
	getRuleset,
	isIdentifiedByCondition,
	RULESETS
} from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import writeExcelFile from 'write-excel-file/node';
import { resolveCase } from '../../resolve-case.ts';
import { firstQueryValue, runRulesetSafely } from '../../run-ruleset.ts';
import { consulteeSelection, excludedMatchIds, reportCreatedUrl } from '../urls.ts';
import type { ConsulteeAreaRecord } from './workbook.ts';
import { buildReportSheets, reportFileName } from './workbook.ts';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// SQL Server takes at most 2,100 parameters per query
const RECORD_BATCH_SIZE = 1000;

/** Every identified consultee's full consultee_area row - Prisma leaves out the geometry columns. */
async function consulteeAreaRecords(db: ManageService['db'], ids: string[]): Promise<Map<string, ConsulteeAreaRecord>> {
	const records = new Map<string, ConsulteeAreaRecord>();
	for (let i = 0; i < ids.length; i += RECORD_BATCH_SIZE) {
		const rows = await db.consulteeArea.findMany({ where: { id: { in: ids.slice(i, i + RECORD_BATCH_SIZE) } } });
		for (const row of rows) {
			records.set(row.id.toLowerCase(), row);
		}
	}
	return records;
}

/**
 * The Report created page's download: the report as an Excel workbook - a Summary tab, then a tab
 * per group of the rulesets workbook listing every consultee the ruleset identified (less removals,
 * plus additions) with all its stored columns but geometry (see workbook.ts). Runs the ruleset as
 * the report pages do; nothing is stored. If the ruleset can't be run, it goes back to the Report
 * created page, which says so.
 */
export function buildReportDownload(service: ManageService): AsyncRequestHandler {
	const { db, logger, nearbyConsulteeRadiusMetres, rulesetRunner } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const project = await resolveCase(db, caseId);
		const requestedRuleset = firstQueryValue(req.query?.ruleset);
		const ruleset = requestedRuleset ? getRuleset(requestedRuleset) : RULESETS[0];
		if (!project || !ruleset) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		const selection = consulteeSelection(req.query);
		const { consultees, failed } = await runRulesetSafely(
			rulesetRunner,
			project,
			ruleset,
			nearbyConsulteeRadiusMetres,
			logger
		);
		if (failed) {
			res.redirect(reportCreatedUrl(project.id, ruleset.id, selection));
			return;
		}

		const excluded = excludedMatchIds(selection.removed);
		const identified = consultees.filter((match) => isIdentifiedByCondition(match) && !excluded.has(match.feature.id));
		const report = {
			caseName: project.properties.caseName,
			caseReference: project.properties.caseReference,
			boundaryFileName: project.properties.fileName ?? null,
			boundaryReceivedDate: project.properties.receivedDate ?? null,
			ruleset,
			generatedAt: new Date(),
			identified,
			records: await consulteeAreaRecords(
				db,
				identified.map((match) => match.feature.id)
			),
			added: selection.adds,
			removed: selection.removed
		};
		logger.info(
			{ caseId: project.id, rulesetId: ruleset.id, consultees: identified.length + selection.adds.length },
			'consultee report download'
		);

		const buffer = await writeExcelFile(buildReportSheets(report)).toBuffer();
		res.set({
			'Content-Type': XLSX_CONTENT_TYPE,
			'Content-Disposition': `attachment; filename="${reportFileName(report)}"`
		});
		res.send(buffer);
	};
}
