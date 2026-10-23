import type { ManageService } from '#service';
import { getRuleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { buildCaseMapConfig, markAddedByHand } from '../../../maps/case-geojson.ts';
import { buildConsulteeStaticMapResponse, sendStaticMapResponse } from '../../../maps/serve-static-map.ts';
import { categorySettings } from '../../../report-config.ts';
import { excludedIds, queryValues } from '../report/urls.ts';
import { resolveCase } from '../resolve-case.ts';
import { buildSearchAreaSafely, firstQueryValue, runRulesetSafely } from '../run-ruleset.ts';

/**
 * A category page's static map - the image its map falls back to without JavaScript, and when the
 * interactive map can't start: the category's consultees less removals, with the nearby ones added
 * by hand drawn as identified. Its URL sits under /results, where it began (categoryStaticMapUrl).
 */
export function buildResultsStaticMap(service: ManageService, forceSvg = false): AsyncRequestHandler {
	const { db, logger } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const project = await resolveCase(db, caseId);
		const ruleset = getRuleset(firstQueryValue(req.query.ruleset));

		if (!project || !ruleset) {
			res.status(404).type('text/plain').send('Not found');
			return;
		}

		const { consultees, failed } = await runRulesetSafely(service, project, ruleset, req.session);
		if (failed) {
			// not an empty map: that would be cached (see Cache-Control below) as if it were a real
			// "no matches" result
			res.status(503).type('text/plain').send('The ruleset could not be run');
			return;
		}
		// a category page's static map draws only that category's non-excluded consultees, with the
		// nearby ones added by hand (`include`) drawn as identified; with no
		// category it's every consultee the run found, same as the interactive map
		const category = firstQueryValue(req.query.category);
		const excluded = excludedIds(req.query.exclude);
		const displayMatches =
			category || excluded.size > 0
				? consultees.filter(
						(match) =>
							(!category || match.feature.properties.consulteeCategory === category) && !excluded.has(match.feature.id)
					)
				: consultees;
		// same search area as the interactive map, so both open on the same view
		const searchArea = await buildSearchAreaSafely(
			db,
			project,
			displayMatches,
			service.nearbySearchRadiusMetres,
			logger
		);
		// a category's map is framed as config/report.yaml sets for the category
		const map = buildCaseMapConfig(
			project,
			markAddedByHand(displayMatches, new Set(queryValues(req.query.include))),
			category || ruleset.name,
			searchArea,
			undefined,
			categorySettings(category).mapMarginMetres
		);
		const ifNoneMatch = typeof req.headers['if-none-match'] === 'string' ? req.headers['if-none-match'] : undefined;
		const accept = typeof req.headers.accept === 'string' ? req.headers.accept : undefined;

		const image = await buildConsulteeStaticMapResponse({
			geometryId: project.id,
			sectionId: ruleset.id,
			map,
			forceSvg,
			ifNoneMatch,
			accept
		});

		sendStaticMapResponse(res, image);
	};
}
