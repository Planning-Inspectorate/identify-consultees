import type { ManageService } from '#service';
import { stringifyForInlineScript } from '#util/inline-json.ts';
import { getRuleset, RULESETS } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { buildCaseMapConfig, MAX_SAMPLED_MAP_MATCHES } from '../../../maps/case-geojson.ts';
import { MAP_VIEWPORT } from '../../../maps/sample-geojson.ts';
import { resolveCase } from '../resolve-case.ts';
import { buildSearchAreaSafely, firstQueryValue, projectPageUrl, runRulesetSafely } from '../run-ruleset.ts';
import { describeCaseSector } from './sector.ts';
import type { ConsulteeProjectViewModel } from './view-model.ts';

/**
 * Step 2 of the identify-consultees flow: the project's map page, where the home page's project
 * links land. It runs the selected ruleset (the first one when none is chosen yet) against the
 * selected shapefile and draws the matches on the map. The Shapefile/Ruleset rows' "Change"
 * links lead to the two picker pages, which return here on "Save and return" - changing the
 * shapefile means landing on the same page for a different case_boundary id. The consultee
 * tables that back the report live on /consultees/:caseId/results.
 */
export function buildConsulteeProjectPage(service: ManageService): AsyncRequestHandler {
	const { db, logger, nearbyConsulteeRadiusMetres } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const project = await resolveCase(db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		// no ?ruleset= means the default (first) ruleset; a present-but-unknown one 404s rather
		// than silently running something other than what a shared link named
		const requestedRuleset = firstQueryValue(req.query.ruleset);
		const ruleset = requestedRuleset ? getRuleset(requestedRuleset) : RULESETS[0];
		if (!ruleset) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		logger.info(
			{ caseId, reference: project.properties.caseReference, rulesetId: ruleset.id },
			'consultee project map page'
		);

		const { matches, failed } = await runRulesetSafely(db, project, ruleset, nearbyConsulteeRadiusMetres, logger);
		const searchArea = await buildSearchAreaSafely(db, project, matches, nearbyConsulteeRadiusMetres, logger);
		const staticMapSrc = `/consultees/${encodeURIComponent(project.id)}/results/static-map?ruleset=${encodeURIComponent(ruleset.id)}`;
		const staticMapAlt = `Static map showing ${ruleset.name} for ${project.properties.caseName}`;
		const map = buildCaseMapConfig(project, matches, ruleset.name, searchArea, {
			src: staticMapSrc,
			alt: staticMapAlt
		});

		const viewModel: ConsulteeProjectViewModel = {
			pageHeading: project.properties.caseName,
			reference: project.properties.caseReference,
			caseName: project.properties.caseName,
			caseId: project.id,
			backLinkUrl: '/',
			backLinkText: 'Back to projects',
			sectorDescription: describeCaseSector(project.properties.caseReference, project.properties.caseName),
			stage: project.properties.acceptance ?? null,
			shapefileName: project.properties.fileName ?? 'Not provided',
			shapefileChangeUrl: `/consultees/${encodeURIComponent(project.id)}/shapefile?ruleset=${encodeURIComponent(ruleset.id)}`,
			rulesetName: ruleset.name,
			rulesetChangeUrl: `/consultees/${encodeURIComponent(project.id)}/ruleset?ruleset=${encodeURIComponent(ruleset.id)}`,
			previewReportUrl: `/consultees/${encodeURIComponent(project.id)}/report?ruleset=${encodeURIComponent(ruleset.id)}`,
			mapId: 'case-map',
			mapRegionLabel: `Map showing ${ruleset.name} for ${project.properties.caseName}`,
			staticMapSrc,
			rulesetFailed: failed,
			retryUrl: projectPageUrl(project.id, ruleset.id),
			staticMapAlt,
			mapWidth: MAP_VIEWPORT.width,
			mapHeight: MAP_VIEWPORT.height,
			mapConfigJson: stringifyForInlineScript(map),
			matchCount: map.matchCount,
			mapIsSampled: map.isSampled,
			mapSampleSize: MAX_SAMPLED_MAP_MATCHES
		};

		return res.render('views/consultees/project/view.njk', viewModel);
	};
}
