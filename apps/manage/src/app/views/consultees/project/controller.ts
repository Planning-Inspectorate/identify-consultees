import type { ManageService } from '#service';
import { stringifyForInlineScript } from '#util/inline-json.ts';
import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import {
	getCaseBoundaryById,
	listCaseBoundaryFiles
} from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import { getRuleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler, AsyncRequestHandlerWithBody } from '@planning-inspectorate/core/util';
import { recencyRanks, styleForRank } from '../../../maps/boundary-map-styles.ts';
import type { BoundaryMapFile } from '../../../maps/boundary-map.ts';
import { buildBoundaryMapConfig } from '../../../maps/boundary-map.ts';
import { buildProjectGeojson } from '../../../maps/case-geojson.ts';
import { computeFittedMapView } from '../../../maps/geometry-bounds.ts';
import { MAP_VIEW } from '../../../maps/map-view.ts';
import type { GeoJsonFeature, GeoJsonFeatureCollection } from '../../../maps/sample-geojson.ts';
import { MAP_VIEWPORT } from '../../../maps/sample-geojson.ts';
import { buildConsulteeStaticMapResponse, sendStaticMapResponse } from '../../../maps/serve-static-map.ts';
import type { ConsulteeSelection } from '../report/urls.ts';
import {
	boundaryUrl,
	changedStep,
	changeProjectUrl,
	consulteeSelection,
	reportUrl,
	rulesetUrl
} from '../report/urls.ts';
import { resolveCase } from '../resolve-case.ts';
import { firstQueryValue } from '../run-ruleset.ts';
import type { TestFault } from '../test-faults.ts';
import { requestTestFault } from '../test-faults.ts';
import type { BoundaryFileOption } from './boundary-files.ts';
import { boundaryFileOptions } from './boundary-files.ts';
import { formatUploadedAt } from './format-uploaded.ts';
import type { BoundaryFileRadio, ConsulteeProjectViewModel } from './view-model.ts';

/**
 * The boundary page's geometry for each file option. Geometry lookups are per case_boundary id -
 * the page's own row is already loaded, so only sibling submissions need a round trip each (never
 * more than a handful).
 */
async function mapFiles(
	db: ManageService['db'],
	project: CaseBoundaryFeature,
	options: BoundaryFileOption[]
): Promise<BoundaryMapFile[]> {
	const files: BoundaryMapFile[] = [];
	for (const option of options) {
		const geometry = (option.id === project.id ? project : await getCaseBoundaryById(db, option.id))?.geometry;
		if (geometry) {
			files.push({
				id: option.id,
				label: option.label,
				receivedDate: option.receivedDate,
				geometry
			});
		}
	}
	return files;
}

/**
 * The check page's project or shapefile being changed (see changedStep): the ruleset it keeps, and
 * - for a shapefile, the same project's - the consultees added and removed. None for a ruleset
 * that isn't one, so a bad link carries on through the journey instead.
 */
function boundaryChange(
	query: Record<string, unknown>
): { step: 'project' | 'shapefile'; rulesetId: string; selection: ConsulteeSelection } | undefined {
	const change = changedStep(query);
	if (!change || change.step === 'ruleset' || !getRuleset(change.rulesetId)) {
		return undefined;
	}
	return {
		step: change.step,
		rulesetId: change.rulesetId,
		selection: change.step === 'shapefile' ? consulteeSelection(query) : consulteeSelection()
	};
}

/**
 * The boundary page's view model: the map draws every shapefile the case holds (the page's own
 * file visible first), and the radios below ask the user to confirm which single file is carried
 * into the report - never pre-selected, so `shapefileError` marks them invalid after an
 * unanswered submit. A map that can't be built - a file's geometry failed to load - is replaced
 * by a GOV.UK error message offering to try again; the radios still render, so the page works
 * without the map.
 */
async function boundaryPageViewModel(
	db: ManageService['db'],
	logger: ManageService['logger'],
	project: CaseBoundaryFeature,
	options: BoundaryFileOption[],
	query: Record<string, unknown>,
	shapefileError?: string,
	fault?: TestFault
): Promise<ConsulteeProjectViewModel> {
	const change = boundaryChange(query);
	const fallback = {
		src: `/consultees/${encodeURIComponent(project.id)}/boundary-map`,
		alt: `Static map showing the project boundary for ${project.properties.caseName}`
	};
	// the QA fault trigger (test-faults.ts): the map load fails as if the geometry store were down
	const map = await (
		fault === 'map'
			? Promise.reject(new Error('test-fail=map: forced boundary map failure'))
			: mapFiles(db, project, options)
	)
		.then((files) =>
			buildBoundaryMapConfig(project.properties.caseName, project.properties.caseReference, files, fallback)
		)
		.catch((error: unknown) => {
			logger.error({ error, caseId: project.id }, 'Failed to load the boundary page map');
			return undefined;
		});

	return {
		pageHeading: 'Project boundary',
		pageCaption: project.properties.caseName,
		reference: project.properties.caseReference,
		caseName: project.properties.caseName,
		caseId: project.id,
		// changing the check page's shapefile, back to it as it was; its project, back to the search
		...(change?.step === 'shapefile'
			? { backLinkUrl: reportUrl(project.id, change.rulesetId, change.selection), backLinkText: 'Back' }
			: {
					backLinkUrl: change ? changeProjectUrl(change.rulesetId) : '/',
					backLinkText: 'Back to projects'
				}),
		formAction: boundaryUrl(project.id, change, change?.selection),
		files: options.map((option): BoundaryFileRadio => ({
			value: option.id,
			text: option.label,
			...(option.receivedDate ? { hint: { text: `Uploaded: ${formatUploadedAt(option.receivedDate)}` } } : {}),
			...(change?.step === 'shapefile' && !shapefileError && option.id === project.id ? { checked: true } : {})
		})),
		...(shapefileError
			? { shapefileError: { text: shapefileError }, errorSummary: [{ text: shapefileError, href: '#shapefile' }] }
			: {}),
		retryUrl: boundaryUrl(project.id, change, change?.selection),
		...(map
			? {
					mapId: 'case-map',
					mapRegionLabel: `Map showing the project boundary for ${project.properties.caseName}`,
					staticMapSrc: fallback.src,
					staticMapAlt: fallback.alt,
					mapWidth: MAP_VIEWPORT.width,
					mapHeight: MAP_VIEWPORT.height,
					mapConfigJson: stringifyForInlineScript(map)
				}
			: { mapFailed: true })
	};
}

/**
 * Step 2 of the identify-consultees flow: the project boundary page, where the home page's
 * project links land. The map draws every shapefile the case holds as toggleable "GIS
 * shapefiles" layers; the radios below confirm which single file is carried into the report -
 * "Continue" leads to the ruleset page. Picking a different file means continuing the journey
 * for that submission's own case_boundary id.
 */
export function buildConsulteeProjectPage(service: ManageService): AsyncRequestHandler {
	const { db, logger } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const project = await resolveCase(db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		logger.info({ caseId, reference: project.properties.caseReference }, 'consultee project boundary page');

		const files = await listCaseBoundaryFiles(db, project.properties.caseReference);
		const options = boundaryFileOptions(files, project.id);
		const viewModel = await boundaryPageViewModel(
			db,
			logger,
			project,
			options,
			req.query,
			undefined,
			requestTestFault(service, req.query) === 'map' ? 'map' : undefined
		);

		return res.render('views/consultees/project/view.njk', viewModel);
	};
}

/**
 * "Continue" on the boundary page: the chosen file must be one of this project's options. The
 * radios are never pre-selected, so an unanswered (or unrecognised) submit re-renders the page
 * with a validation error rather than guessing a file. On to the ruleset page - or, changing the
 * check page's project or shapefile, back to the check page.
 */
export function buildBoundarySubmit(service: ManageService): AsyncRequestHandlerWithBody<{ shapefile?: unknown }> {
	const { db, logger } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const project = await resolveCase(db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		const files = await listCaseBoundaryFiles(db, project.properties.caseReference);
		const options = boundaryFileOptions(files, project.id);
		const chosen = options.find((option) => option.id === firstQueryValue(req.body?.shapefile));
		if (!chosen) {
			res.render(
				'views/consultees/project/view.njk',
				await boundaryPageViewModel(
					db,
					logger,
					project,
					options,
					req.query ?? {},
					'Select a shapefile',
					requestTestFault(service, req.query) === 'map' ? 'map' : undefined
				)
			);
			return;
		}

		// changing the check page's project or shapefile goes straight back to it, with its ruleset
		const change = boundaryChange(req.query ?? {});
		res.redirect(change ? reportUrl(chosen.id, change.rulesetId, change.selection) : rulesetUrl(chosen.id));
	};
}

/**
 * Every file the case holds, for the boundary page's noscript/init-failure static map - as the
 * interactive map draws them: each in its own style by how recent it is (see
 * config/map-styles/boundary-map.yaml), the most recent drawn last, on top.
 */
async function allBoundaryFilesGeojson(
	db: ManageService['db'],
	project: CaseBoundaryFeature
): Promise<GeoJsonFeatureCollection> {
	const listed = await listCaseBoundaryFiles(db, project.properties.caseReference);
	// the page's own file, even if it's gone from the list since the page loaded
	const files = listed.some((file) => file.id === project.id)
		? listed
		: [...listed, { id: project.id, receivedDate: project.properties.receivedDate ?? null }];
	const ranks = recencyRanks(files.map((file) => file.receivedDate));
	const features: GeoJsonFeature[] = [];
	// highest rank (oldest) first, so the most recent is drawn over the rest
	for (const index of files.map((_file, i) => i).sort((a, b) => ranks[b] - ranks[a])) {
		const file = files[index];
		const geometry = (file.id === project.id ? project : await getCaseBoundaryById(db, file.id))?.geometry;
		if (geometry) {
			const style = styleForRank(ranks[index]);
			const [feature] = buildProjectGeojson({ ...project, id: file.id, geometry }).features;
			features.push({
				...feature,
				properties: { ...feature.properties, colour: style.colour, fillOpacity: String(style.fillOpacity) }
			});
		}
	}
	return { type: 'FeatureCollection', features };
}

export function buildBoundaryStaticMap(service: ManageService, forceSvg = false): AsyncRequestHandler {
	const { db } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const project = await resolveCase(db, caseId);
		if (!project) {
			res.status(404).type('text/plain').send('Not found');
			return;
		}

		const projectGeojson = await allBoundaryFilesGeojson(db, project);
		const view = computeFittedMapView(projectGeojson, MAP_VIEWPORT, MAP_VIEW.boundaryMapMarginMetres);
		const image = await buildConsulteeStaticMapResponse({
			geometryId: project.id,
			sectionId: 'boundary',
			map: {
				center: view.center,
				zoom: view.zoom,
				projectGeojson,
				consulteeGeojson: { type: 'FeatureCollection', features: [] },
				width: MAP_VIEWPORT.width,
				height: MAP_VIEWPORT.height,
				title: `Project boundary for ${project.properties.caseName}`
			},
			forceSvg,
			ifNoneMatch: typeof req.headers['if-none-match'] === 'string' ? req.headers['if-none-match'] : undefined,
			accept: typeof req.headers.accept === 'string' ? req.headers.accept : undefined
		});

		sendStaticMapResponse(res, image);
	};
}
