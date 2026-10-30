import { MapCache } from '#lib/util/index.ts';
import type { ManageService } from '#service';
import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import { bufferGeometryForDisplay } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import type {
	ConsulteeMatch,
	Ruleset,
	SiteScreenedAs
} from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { isIdentified } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { Geometry } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';
import { strToU8, zipSync } from 'fflate';
import writeExcelFile from 'write-excel-file/node';
import type { CaseMapConfig } from '../../../../maps/case-geojson.ts';
import { buildCaseMapConfig, markAddedByHand, REGIONAL_FILL_OPACITY } from '../../../../maps/case-geojson.ts';
import { computeBounds, computeFittedMapView } from '../../../../maps/geometry-bounds.ts';
import { MAP_VIEWPORT } from '../../../../maps/sample-geojson.ts';
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
	/** What the run screened - the outline unless said otherwise. */
	siteScreenedAs?: SiteScreenedAs;
}

// how far the bounding box a too-detailed site is screened as reaches past it - as
// apps/function-python/intersector/queries.py's BOUNDING_BOX_MARGIN_METRES
const BOUNDING_BOX_MARGIN_METRES = 1_000;
const METRES_PER_DEGREE = 111_320;
// how much a map shows past what it frames, as a share of the framed span - so an outline isn't on
// its edge
const MAP_FRAME_PADDING = 0.05;
// the report's maps are drawn at 1.5 image pixels per map pixel - sharp printed or zoomed in, for
// about 1.75 times the OSM tiles of a plain map
const MAP_PIXEL_RATIO = 1.5;

/**
 * The distances a category's consultees were looked for within: each ruleset condition that finds
 * the category within a buffer of the site, or - for Nearby NSIPs - the Nearby NSIPs distance.
 * Smallest first, each once; a condition that needs them to touch the site, or borders a host area,
 * has none.
 */
export function categoryBufferMetres(ruleset: Ruleset, category: string, nearbyNsipRadiusMetres: number): number[] {
	const metres =
		category === NEARBY_NSIPS
			? [nearbyNsipRadiusMetres]
			: ruleset.rules
					.filter((rule) => rule.logicType === 'intersection' && rule.categories.includes(category))
					.map((rule) => rule.bufferMetres ?? 0);
	return [...new Set(metres.filter((value) => value > 0))].toSorted((a, b) => a - b);
}

/** A buffer distance as the map and its key give it - `500 m`, `2 km`, `1.5 km`. */
export function formatBufferDistance(metres: number): string {
	return metres < 1000 ? `${Math.round(metres)} m` : `${Math.round(metres / 100) / 10} km`;
}

/**
 * What a run screened, to grow the buffers from: the site's outline, or the rectangle around it
 * (grown by BOUNDING_BOX_MARGIN_METRES) for a site too detailed to screen in time - as the
 * function's bounding_box builds it.
 */
export function screenedSite(project: CaseBoundaryFeature, siteScreenedAs: SiteScreenedAs): Geometry {
	if (siteScreenedAs !== 'boundingBox') {
		return project.geometry;
	}
	const bounds = computeBounds({ features: [{ geometry: project.geometry }] })!;
	const latitudeMargin = BOUNDING_BOX_MARGIN_METRES / METRES_PER_DEGREE;
	const widest = Math.max(Math.abs(bounds.south), Math.abs(bounds.north)) + latitudeMargin;
	const longitudeMargin =
		BOUNDING_BOX_MARGIN_METRES / (METRES_PER_DEGREE * Math.cos((Math.min(widest, 89) * Math.PI) / 180));
	const [west, east] = [bounds.west - longitudeMargin, bounds.east + longitudeMargin];
	const [south, north] = [bounds.south - latitudeMargin, bounds.north + latitudeMargin];
	return {
		type: 'Polygon',
		coordinates: [
			[
				[west, south],
				[east, south],
				[east, north],
				[west, north],
				[west, south]
			]
		]
	};
}

/** A report being built: its context, and the buffers its maps have drawn, by distance - shared by its maps. */
interface ReportMapsContext extends ReportZipContext {
	buffers: Map<number, Promise<Geometry | undefined>>;
}

/** The site - as the run screened it - grown by `metres`, once per report; none if it can't be drawn. */
function bufferAroundSite(context: ReportMapsContext, metres: number): Promise<Geometry | undefined> {
	let buffer = context.buffers.get(metres);
	if (!buffer) {
		const { service, project, siteScreenedAs = 'outline' } = context;
		buffer = bufferGeometryForDisplay(service.db, screenedSite(project, siteScreenedAs), metres).catch(
			(error: unknown) => {
				// a buffer that can't be drawn leaves it off the map - the rest still draws
				service.logger.warn({ error, caseId: project.id, metres }, 'could not draw a buffer on the report map');
				return undefined;
			}
		);
		context.buffers.set(metres, buffer);
	}
	return buffer;
}

/**
 * Where a category's map looks: the bounding box of what it's about - the site, the ruleset's buffers
 * around it, and the category's areas in the report but for regional ones (a county or police force
 * would zoom out until the site is lost) - with MAP_FRAME_PADDING around it, at the exact zoom that
 * fills the map. With nothing to frame but the site, the site with the category's mapKm around it.
 */
export function reportMapView(
	map: Pick<CaseMapConfig, 'projectGeojson' | 'consulteeGeojson'>,
	buffers: Geometry[],
	mapMarginMetres: number
): Pick<CaseMapConfig, 'center' | 'zoom'> {
	const local = map.consulteeGeojson.features.filter(
		(feature) => feature.properties.fillOpacity !== String(REGIONAL_FILL_OPACITY)
	);
	const framed = [...map.projectGeojson.features, ...buffers.map((geometry) => ({ geometry })), ...local];
	if (framed.length === map.projectGeojson.features.length) {
		return computeFittedMapView(map.projectGeojson, MAP_VIEWPORT, mapMarginMetres, { wholeZoom: false });
	}
	const bounds = computeBounds({ features: framed })!;
	const latitude = (bounds.north + bounds.south) / 2;
	const spanMetres = Math.max(
		(bounds.east - bounds.west) * METRES_PER_DEGREE * Math.cos((latitude * Math.PI) / 180),
		(bounds.north - bounds.south) * METRES_PER_DEGREE
	);
	return computeFittedMapView({ features: framed }, MAP_VIEWPORT, spanMetres * MAP_FRAME_PADDING, {
		wholeZoom: false
	});
}

/**
 * One category's map for the PDF: the category's consultees in the report - those the ruleset
 * identified, less removals, and those added by hand - each named on it, over a grey basemap, with
 * the ruleset's buffers for the category drawn around the site. As a PNG, with the colours it draws
 * in and the buffers it shows, for the PDF's key.
 */
async function categoryMap(
	context: ReportMapsContext,
	category: string
): Promise<Pick<MapPdfInput, 'image' | 'colours' | 'buffers' | 'mapNote'>> {
	const { service, project, ruleset, consultees, selection } = context;
	const excluded = excludedMatchIds(selection.removed);
	const added = addedMatchIds(selection.adds);
	// consultees only the nearby search found aren't in the report, so aren't drawn - they made the
	// maps harder to read
	const visible = consultees.filter(
		(match) =>
			match.feature.properties.consulteeCategory === category &&
			!excluded.has(match.feature.id) &&
			(isIdentified(match) || added.has(match.feature.id))
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
	const bufferMetres = categoryBufferMetres(ruleset, category, service.nearbyNsipRadiusMetres);
	const buffers = (
		await Promise.all(
			bufferMetres.map(async (metres) => ({ metres, geometry: await bufferAroundSite(context, metres) }))
		)
	).filter((buffer): buffer is { metres: number; geometry: Geometry } => buffer.geometry !== undefined);
	const map = buildCaseMapConfig(project, markAddedByHand(visible, added), category, searchArea);
	const view = reportMapView(
		map,
		buffers.map(({ geometry }) => geometry),
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
		map: {
			...map,
			...view,
			pixelRatio: MAP_PIXEL_RATIO,
			labels: true,
			basemap: 'greyscale',
			bufferGeojson: {
				type: 'FeatureCollection',
				features: buffers.map(({ metres, geometry }) => ({
					type: 'Feature',
					properties: { label: formatBufferDistance(metres) },
					geometry
				}))
			}
		},
		accept: 'image/png'
	});
	return {
		image: image.body as Buffer,
		colours,
		buffers: buffers.map(({ metres }) => formatBufferDistance(metres)),
		...(mapNote ? { mapNote } : {})
	};
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
	selection,
	siteScreenedAs = 'outline'
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
		siteScreenedAs,
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
	const context: ReportMapsContext = {
		service,
		project,
		ruleset,
		consultees,
		selection,
		siteScreenedAs,
		buffers: new Map()
	};
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
