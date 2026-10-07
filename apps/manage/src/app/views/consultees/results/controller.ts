import type { ManageService } from '#service';
import { stringifyForInlineScript } from '#util/inline-json.ts';
import type { ConsulteeAreaSummaryMatch } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import { getRuleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { buildCaseMapConfig, MAX_SAMPLED_MAP_MATCHES } from '../../../maps/case-geojson.ts';
import { MAP_VIEWPORT } from '../../../maps/sample-geojson.ts';
import { buildConsulteeStaticMapResponse } from '../../../maps/serve-static-map.ts';
import { excludedIds } from '../report/urls.ts';
import { resolveCase } from '../resolve-case.ts';
import { buildSearchAreaSafely, firstQueryValue, projectPageUrl, runRulesetSafely } from '../run-ruleset.ts';
import type { ConsulteeMatchRow, ConsulteesResultsViewModel } from './view-model.ts';

function resultsUrl(caseId: string, rulesetId: string): string {
	return `/consultees/${encodeURIComponent(caseId)}/results?ruleset=${encodeURIComponent(rulesetId)}`;
}

function toMatchRow(match: ConsulteeAreaSummaryMatch): ConsulteeMatchRow {
	return {
		consultee: match.feature.properties.consultee ?? null,
		consulteeCategory: match.feature.properties.consulteeCategory ?? null,
		region: match.feature.properties.region ?? null
	};
}

/**
 * The consultee report for the map page's selection: the same ruleset run the map page drew, with
 * every matching consultee listed in tables.
 */
export function buildConsulteesResultsPage(service: ManageService): AsyncRequestHandler {
	const { db, logger, nearbyConsulteeRadiusMetres } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const project = await resolveCase(db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		const ruleset = getRuleset(firstQueryValue(req.query.ruleset));
		if (!ruleset) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		logger.info(
			{ caseId, reference: project.properties.caseReference, rulesetId: ruleset.id },
			'consultees results page'
		);

		const { matches, allNearby, failed } = await runRulesetSafely(
			db,
			project,
			ruleset,
			nearbyConsulteeRadiusMetres,
			logger
		);
		const searchArea = await buildSearchAreaSafely(
			db,
			project,
			matches,
			allNearby,
			nearbyConsulteeRadiusMetres,
			logger
		);
		const staticMapSrc = `/consultees/${encodeURIComponent(project.id)}/results/static-map?ruleset=${encodeURIComponent(ruleset.id)}`;
		const staticMapAlt = `Static map showing ${ruleset.name} for ${project.properties.caseName}`;
		const map = buildCaseMapConfig(project, matches, ruleset.name, searchArea, {
			src: staticMapSrc,
			alt: staticMapAlt
		});

		const viewModel: ConsulteesResultsViewModel = {
			pageHeading: `Consultees identified for ${project.properties.caseName} (${project.properties.caseReference})`,
			backLinkUrl: projectPageUrl(project.id, ruleset.id),
			rulesetName: ruleset.name,
			reference: project.properties.caseReference,
			caseName: project.properties.caseName,
			caseId: project.id,
			mapId: 'case-map',
			mapRegionLabel: `Map showing ${ruleset.name} for ${project.properties.caseName}`,
			staticMapSrc,
			rulesetFailed: failed,
			retryUrl: resultsUrl(project.id, ruleset.id),
			staticMapAlt,
			mapWidth: MAP_VIEWPORT.width,
			mapHeight: MAP_VIEWPORT.height,
			mapConfigJson: stringifyForInlineScript(map),
			matches: matches.map(toMatchRow),
			matchCount: map.matchCount,
			mapIsSampled: map.isSampled,
			mapSampleSize: MAX_SAMPLED_MAP_MATCHES,
			nearbyMatches: allNearby.map(toMatchRow),
			nearbyMatchCount: allNearby.length,
			nearbyRadiusKm: nearbyConsulteeRadiusMetres / 1000
		};

		return res.render('views/consultees/results/view.njk', viewModel);
	};
}

export function buildResultsStaticMap(service: ManageService, forceSvg = false): AsyncRequestHandler {
	const { db, logger, nearbyConsulteeRadiusMetres } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const project = await resolveCase(db, caseId);
		const ruleset = getRuleset(firstQueryValue(req.query.ruleset));

		if (!project || !ruleset) {
			res.status(404).type('text/plain').send('Not found');
			return;
		}

		const { matches, allNearby, failed } = await runRulesetSafely(
			db,
			project,
			ruleset,
			nearbyConsulteeRadiusMetres,
			logger
		);
		if (failed) {
			// not an empty map: that would be cached (see Cache-Control below) as if it were a real
			// "no matches" result
			res.status(503).type('text/plain').send('The ruleset could not be run');
			return;
		}
		// a category page's static map draws only that category's non-excluded matches; with no
		// category this stays the whole ruleset's matches, same as the interactive map
		const category = firstQueryValue(req.query.category);
		const excluded = excludedIds(req.query.exclude);
		const displayMatches =
			category || excluded.size > 0
				? matches.filter(
						(match) =>
							(!category || match.feature.properties.consulteeCategory === category) && !excluded.has(match.feature.id)
					)
				: matches;
		// same search area as the interactive map, so both open on the same view - the static renderer
		// draws the project and matches only, not the nearby layer
		const searchArea = await buildSearchAreaSafely(
			db,
			project,
			displayMatches,
			category ? [] : allNearby,
			nearbyConsulteeRadiusMetres,
			logger
		);
		const map = buildCaseMapConfig(project, displayMatches, category || ruleset.name, searchArea);
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

		res
			.status(image.status)
			.set({
				'Cache-Control': image.cacheControl,
				ETag: image.etag,
				...(image.vary ? { Vary: image.vary } : {})
			})
			.type(image.contentType);

		if (image.status === 304) {
			res.end();
			return;
		}

		res.send(image.body);
	};
}
