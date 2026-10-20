import type { ManageService } from '#service';
import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { ConsulteeMatch, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { isIdentified } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { MapCache } from '@planning-inspectorate/core/util';
import { strToU8, zipSync } from 'fflate';
import writeExcelFile from 'write-excel-file/node';
import { buildCaseMapConfig, markAddedByHand } from '../../../../maps/case-geojson.ts';
import { buildConsulteeStaticMapResponse } from '../../../../maps/serve-static-map.ts';
import { consulteeColours, projectColours } from '../../../../maps/static-map.ts';
import { categorySettings } from '../../../../report-config.ts';
import { isNearbyNsip, NEARBY_NSIPS } from '../../nearby-nsips.ts';
import { buildSearchAreaSafely, RULESET_RUN_MAX_AGE_MS } from '../../run-ruleset.ts';
import { reportByCategory } from '../report-consultees.ts';
import type { ConsulteeSelection } from '../urls.ts';
import { addedMatchIds, excludedMatchIds } from '../urls.ts';
import type { MapPdfInput } from './map-pdf.ts';
import { buildMapPdf } from './map-pdf.ts';
import type { ConsulteeAreaRecord } from './workbook.ts';
import { buildReportSheets, formatDate, reportFileName, safeFileName } from './workbook.ts';

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

/**
 * Each Nearby NSIP's row for the report, by id, as a consultee's would be: built from its
 * case_boundary row, with the case's details - and how far it is from the site - as its metadata.
 */
async function nearbyNsipRecords(
	db: ManageService['db'],
	matches: ConsulteeMatch[]
): Promise<Map<string, ConsulteeAreaRecord>> {
	const records = new Map<string, ConsulteeAreaRecord>();
	if (matches.length === 0) {
		return records;
	}
	const distances = new Map(matches.map((match) => [match.feature.id, match.distanceMetres]));
	const rows = await db.caseBoundary.findMany({ where: { id: { in: [...distances.keys()] } } });
	for (const row of rows) {
		const id = row.id.toLowerCase();
		records.set(id, {
			id,
			geometryType: row.geometryType,
			sourceId: row.caseReference,
			consulteeCategory: NEARBY_NSIPS,
			consulteeGroup: NEARBY_NSIPS,
			consulteeSubcategory: null,
			consulteeSubcategoryDescription: null,
			consultee: `${row.caseName} (${row.caseReference})`,
			region: null,
			metadata: JSON.stringify({
				'Case reference': row.caseReference,
				'Project name': row.caseName,
				Shapefile: row.fileName,
				Received: row.receivedDate ? formatDate(row.receivedDate) : null,
				'Distance (km)': Math.round(distances.get(id)! / 10) / 100
			}),
			lastUpdated: row.lastUpdated
		});
	}
	return records;
}

export interface ReportZipContext {
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
	{ service, project, ruleset, consultees, selection }: ReportZipContext,
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
		searchArea,
		undefined,
		categorySettings(category).mapMarginMetres
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

/** A download's size as the link gives it - `512KB`, `1.4MB`, `25MB`. */
export function formatFileSize(bytes: number): string {
	if (bytes < 1024 * 1024) {
		return `${Math.max(1, Math.round(bytes / 1024))}KB`;
	}
	return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`;
}

/** The report ZIP as it's built: the Content-Disposition file name and the ZIP itself. */
export interface ReportZip {
	fileName: string;
	contents: Buffer;
}

/**
 * The report as a ZIP: an Excel workbook (see workbook.ts) and a PDF of each of its categories'
 * maps (see map-pdf.ts), drawn as the category pages left them - removals gone, and nearby
 * consultees added by hand drawn as identified. Built from a ruleset run's results (the session's
 * kept run, usually, so it doesn't run again).
 */
export async function buildReportZip({
	service,
	project,
	ruleset,
	consultees,
	selection
}: ReportZipContext): Promise<ReportZip> {
	const { db, logger } = service;
	const excluded = excludedMatchIds(selection.removed);
	const identified = consultees.filter((match) => isIdentified(match) && !excluded.has(match.feature.id));
	const report = {
		caseName: project.properties.caseName,
		caseReference: project.properties.caseReference,
		boundaryFileName: project.properties.fileName ?? null,
		boundaryReceivedDate: project.properties.receivedDate ?? null,
		ruleset,
		generatedAt: new Date(),
		identified,
		records: new Map([
			...(await consulteeAreaRecords(db, [
				...identified.filter((match) => !isNearbyNsip(match)).map((match) => match.feature.id),
				...addedMatchIds(selection.adds)
			])),
			...(await nearbyNsipRecords(db, identified.filter(isNearbyNsip)))
		]),
		// a hand-added consultee the run found has its distance - for the distanceKm column
		added: selection.adds.map((add) => {
			const found = add.id ? consultees.find((match) => match.feature.id === add.id) : undefined;
			return found ? { ...add, distanceMetres: found.distanceMetres } : add;
		}),
		removed: selection.removed
	};
	const files: Record<string, Uint8Array> = {
		[reportFileName(report)]: new Uint8Array(await writeExcelFile(buildReportSheets(report)).toBuffer())
	};

	const sections = reportByCategory(ruleset, consultees, selection);
	const context: ReportZipContext = { service, project, ruleset, consultees, selection };
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
		'consultee report built'
	);
	return { fileName: reportFileName(report, 'zip'), contents: Buffer.from(zipSync(files)) };
}

// the newest few reports are plenty - each is tens of MB of process memory
const MAX_REMEMBERED_REPORTS = 5;

/**
 * Reports the Report created page built, kept for its download link to serve. Building the ZIP is
 * the download's whole job - a map PDF per category - so the created page builds it once (its link
 * gives the file's size, knowable only once the report exists) and leaves it here, keyed by the
 * download URL that produced it. Entries keep for as long as the session keeps the ruleset run;
 * after a restart or expiry the download just builds the report again. Process memory only -
 * nothing is stored.
 */
const rememberedReports = new MapCache<ReportZip>(RULESET_RUN_MAX_AGE_MS / 60_000);

/** The report a download URL's created page built, if it hasn't expired. */
export function rememberedReportZip(downloadUrl: string): ReportZip | undefined {
	return rememberedReports.get(downloadUrl);
}

/** Keep a built report for its download URL to serve - see rememberedReports. */
export function rememberReportZip(downloadUrl: string, report: ReportZip): void {
	// a Map iterates oldest-first - drop the oldest reports once the cap is reached
	for (const key of [...rememberedReports.cache.keys()].slice(
		0,
		rememberedReports.cache.size - MAX_REMEMBERED_REPORTS + 1
	)) {
		rememberedReports.cache.delete(key);
	}
	rememberedReports.set(downloadUrl, report);
}
