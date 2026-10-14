import type { ManageService } from '#service';
import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { ConsulteeMatch, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import {
	getRuleset,
	isIdentifiedByCondition,
	RULESETS
} from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { strToU8, zipSync } from 'fflate';
import writeExcelFile from 'write-excel-file/node';
import { buildCaseMapConfig, markAddedByHand } from '../../../../maps/case-geojson.ts';
import { buildConsulteeStaticMapResponse } from '../../../../maps/serve-static-map.ts';
import { consulteeColours, projectColours } from '../../../../maps/static-map.ts';
import { resolveCase } from '../../resolve-case.ts';
import { buildSearchAreaSafely, firstQueryValue, runRulesetSafely } from '../../run-ruleset.ts';
import { reportByCategory } from '../report-consultees.ts';
import type { ConsulteeSelection } from '../urls.ts';
import { addedMatchIds, consulteeSelection, excludedMatchIds, reportCreatedUrl } from '../urls.ts';
import type { MapPdfInput } from './map-pdf.ts';
import { buildMapPdf } from './map-pdf.ts';
import type { ConsulteeAreaRecord } from './workbook.ts';
import { buildReportSheets, reportFileName, safeFileName } from './workbook.ts';

// SQL Server takes at most 2,100 parameters per query
const RECORD_BATCH_SIZE = 1000;

/** Each consultee's full consultee_area row, by id - Prisma leaves out the geometry columns. */
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

interface CategoryMapContext {
	service: ManageService;
	project: CaseBoundaryFeature;
	ruleset: Ruleset;
	consultees: ConsulteeMatch[];
	selection: ConsulteeSelection;
}

/**
 * One category's map as its Change page draws it - the category's consultees less removals, nearby
 * ones faint and the ones added by hand as identified - as a PNG for the PDF,
 * with the colours it draws in for the PDF's key.
 */
async function categoryMap(
	{ service, project, ruleset, consultees, selection }: CategoryMapContext,
	category: string
): Promise<Pick<MapPdfInput, 'image' | 'colours' | 'mapNote'>> {
	const excluded = excludedMatchIds(selection.removed);
	const visible = consultees.filter(
		(match) => match.feature.properties.consulteeCategory === category && !excluded.has(match.feature.id)
	);
	// its own search area, as its Change page builds - an area that can't be drawn spoils only its
	// category's map
	const searchArea = await buildSearchAreaSafely(
		service.db,
		project,
		visible,
		service.nearbySearchRadiusMetres,
		service.logger
	);
	const map = buildCaseMapConfig(
		project,
		markAddedByHand(visible, addedMatchIds(selection.adds)),
		category,
		searchArea
	);
	const site = projectColours(map.projectGeojson.features[0]);
	const colours = {
		consultee: consulteeColours(map.consulteeGeojson.features[0] ?? { properties: {} }).stroke,
		site: site.stroke,
		siteFillOpacity: site.fillOpacity
	};
	// a kept run has no geometry, so without display geometry the map shows the site alone
	const mapNote =
		visible.length > 0 && map.consulteeGeojson.features.length === 0
			? 'The consultee areas could not be drawn on this map. They are listed on the next page.'
			: undefined;
	const image = await buildConsulteeStaticMapResponse({
		geometryId: project.id,
		sectionId: ruleset.id,
		map,
		accept: 'image/png'
	});
	return { image: image.body as Buffer, colours, ...(mapNote ? { mapNote } : {}) };
}

/**
 * The Report created page's download: a ZIP of the report as an Excel workbook (see workbook.ts)
 * and a PDF of each of its categories' maps (see map-pdf.ts), drawn as the category pages left them
 * - removals gone, and nearby consultees added by hand drawn as identified. Uses
 * the run the report pages kept in the session (see runRulesetSafely), so the ruleset only runs
 * again if that has gone; nothing is stored. If the ruleset can't be run, it goes back to the Report
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
			logger,
			req.session
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
			records: await consulteeAreaRecords(db, [
				...identified.map((match) => match.feature.id),
				...addedMatchIds(selection.adds)
			]),
			added: selection.adds,
			removed: selection.removed
		};
		const files: Record<string, Uint8Array> = {
			[reportFileName(report)]: new Uint8Array(await writeExcelFile(buildReportSheets(report)).toBuffer())
		};

		const sections = reportByCategory(ruleset, consultees, selection);
		const context: CategoryMapContext = { service, project, ruleset, consultees, selection };
		// one at a time: the maps frame the same view, so they share basemap tiles - fetched once,
		// then cached (see AGENTS.md)
		for (const [index, section] of sections.entries()) {
			const pdf = await buildMapPdf({
				caseName: report.caseName,
				caseReference: report.caseReference,
				rulesetName: ruleset.name,
				boundaryFileName: report.boundaryFileName,
				generatedAt: report.generatedAt,
				category: section.category,
				...(await categoryMap(context, section.category)),
				consultees: section.consultees
			});
			const number = String(index + 1).padStart(2, '0');
			files[`maps/${number} ${safeFileName(section.category)}.pdf`] = new Uint8Array(pdf);
		}
		if (sections.length === 0) {
			files['maps/README.txt'] = strToU8('No consultees are in the report, so there are no maps.\n');
		}

		logger.info(
			{
				caseId: project.id,
				rulesetId: ruleset.id,
				consultees: identified.length + selection.adds.length,
				maps: sections.length
			},
			'consultee report download'
		);
		res.set({
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${reportFileName(report, 'zip')}"`
		});
		res.send(Buffer.from(zipSync(files)));
	};
}
