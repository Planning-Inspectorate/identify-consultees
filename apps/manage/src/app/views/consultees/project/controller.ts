import type { ManageService } from '#service';
import { stringifyForInlineScript } from '#util/inline-json.ts';
import {
	getCaseBoundaryById,
	listCaseBoundaryFiles
} from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { AsyncRequestHandler, AsyncRequestHandlerWithBody } from '@planning-inspectorate/core/util';
import type { BoundaryMapFile } from '../../../maps/boundary-map.ts';
import { buildBoundaryMapConfig } from '../../../maps/boundary-map.ts';
import { buildProjectGeojson } from '../../../maps/case-geojson.ts';
import { computeMapView } from '../../../maps/geometry-bounds.ts';
import { MAP_VIEWPORT } from '../../../maps/sample-geojson.ts';
import { buildConsulteeStaticMapResponse, sendStaticMapResponse } from '../../../maps/serve-static-map.ts';
import { resolveCase, resolveCaseSummary } from '../resolve-case.ts';
import { firstQueryValue } from '../run-ruleset.ts';
import { boundaryFileOptions, scaledGeometry } from './boundary-files.ts';
import { formatUploadedAt } from './format-uploaded.ts';
import type { BoundaryFileRadio, ConsulteeProjectViewModel } from './view-model.ts';

/**
 * The boundary page's geometry for each file option: real files' stored boundaries, and the
 * stand-in file's scaled copy of the real boundary it stands in for (see boundary-files.ts).
 * Geometry lookups are per case_boundary id - the page's own row is already loaded, so only
 * sibling submissions need a round trip each (never more than a handful).
 */
async function mapFiles(
	db: ManageService['db'],
	project: NonNullable<Awaited<ReturnType<typeof resolveCase>>>,
	options: ReturnType<typeof boundaryFileOptions>
): Promise<BoundaryMapFile[]> {
	const geometries = new Map<string, Awaited<ReturnType<typeof getCaseBoundaryById>>>();
	for (const targetId of [...new Set(options.map((option) => option.targetId))]) {
		geometries.set(targetId, targetId === project.id ? project : await getCaseBoundaryById(db, targetId));
	}
	return options.flatMap((option) => {
		const geometry = geometries.get(option.targetId)?.geometry;
		if (!geometry) {
			return [];
		}
		return [
			{
				id: option.id,
				label: option.label,
				checked: option.checked,
				geometry: option.mock ? scaledGeometry(geometry) : geometry
			}
		];
	});
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
		const options = boundaryFileOptions(files, project.id, project.properties.caseName);
		const map = buildBoundaryMapConfig(
			project.properties.caseName,
			project.properties.caseReference,
			await mapFiles(db, project, options),
			{
				src: `/consultees/${encodeURIComponent(project.id)}/boundary-map`,
				alt: `Static map showing the project boundary for ${project.properties.caseName}`
			}
		);

		const viewModel: ConsulteeProjectViewModel = {
			pageHeading: 'Project boundary',
			pageCaption: project.properties.caseName,
			reference: project.properties.caseReference,
			caseName: project.properties.caseName,
			caseId: project.id,
			backLinkUrl: '/',
			backLinkText: 'Back to projects',
			formAction: `/consultees/${encodeURIComponent(project.id)}`,
			files: options.map((option): BoundaryFileRadio => ({
				value: option.id,
				text: option.label,
				...(option.receivedDate ? { hint: { text: `Uploaded: ${formatUploadedAt(option.receivedDate)}` } } : {}),
				checked: option.checked
			})),
			mapId: 'case-map',
			mapRegionLabel: `Map showing the project boundary for ${project.properties.caseName}`,
			staticMapSrc: `/consultees/${encodeURIComponent(project.id)}/boundary-map`,
			staticMapAlt: `Static map showing the project boundary for ${project.properties.caseName}`,
			mapWidth: MAP_VIEWPORT.width,
			mapHeight: MAP_VIEWPORT.height,
			mapConfigJson: stringifyForInlineScript(map)
		};

		return res.render('views/consultees/project/view.njk', viewModel);
	};
}

/**
 * "Continue" on the boundary page: the chosen file must be one of this project's options -
 * anything else (or a missing selection) just returns to the page unchanged. The stand-in file
 * leads on with the real boundary it stands in for (its targetId).
 */
export function buildBoundarySubmit(service: ManageService): AsyncRequestHandlerWithBody<{ shapefile?: unknown }> {
	const { db } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const project = await resolveCaseSummary(db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		const files = await listCaseBoundaryFiles(db, project.reference);
		const options = boundaryFileOptions(files, project.id, project.caseName);
		const chosen = options.find((option) => option.id === firstQueryValue(req.body?.shapefile));
		if (!chosen) {
			res.redirect(`/consultees/${encodeURIComponent(project.id)}`);
			return;
		}

		res.redirect(`/consultees/${encodeURIComponent(chosen.targetId)}/ruleset`);
	};
}

/**
 * The boundary page's noscript/init-failure static map: the current file's boundary alone,
 * matching what the interactive map draws first (other files stay unchecked in its Layers menu).
 */
export function buildBoundaryStaticMap(service: ManageService, forceSvg = false): AsyncRequestHandler {
	const { db } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const project = await resolveCase(db, caseId);
		if (!project) {
			res.status(404).type('text/plain').send('Not found');
			return;
		}

		const projectGeojson = buildProjectGeojson(project);
		const view = computeMapView(projectGeojson);
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
