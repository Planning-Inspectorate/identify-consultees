import type { ManageService } from '#service';
import { stringifyForInlineScript } from '#util/inline-json.ts';
import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type {
	ConsulteeAreaMatch,
	ConsulteeAreaSummaryMatch
} from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import {
	bufferGeometryForDisplay,
	getConsulteeAreaDisplayGeometries
} from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import type { Ruleset, RunRulesetResult } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { getRuleset, runRuleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import type { SearchAreaDisplay } from '../../../maps/case-geojson.ts';
import { buildCaseMapConfig, MAX_SAMPLED_MAP_MATCHES } from '../../../maps/case-geojson.ts';
import { MAP_VIEWPORT } from '../../../maps/sample-geojson.ts';
import { buildConsulteeStaticMapResponse } from '../../../maps/serve-static-map.ts';
import { resolveCase } from '../resolve-case.ts';
import type { ConsulteeMatchRow, ConsulteesResultsViewModel } from './view-model.ts';

function firstQueryValue(value: unknown): string {
	if (Array.isArray(value)) {
		return typeof value[0] === 'string' ? value[0] : '';
	}
	return typeof value === 'string' ? value : '';
}

interface RulesetRun extends RunRulesetResult {
	// distinguishes "ran and matched nothing" from "couldn't run" - both have empty results
	failed: boolean;
}

async function runRulesetSafely(
	db: ManageService['db'],
	project: CaseBoundaryFeature,
	ruleset: Ruleset,
	nearbyRadiusMetres: number,
	logger: ManageService['logger']
): Promise<RulesetRun> {
	try {
		return { ...(await runRuleset(db, project.geometry, ruleset, nearbyRadiusMetres)), failed: false };
	} catch (error) {
		logger.error({ error, caseId: project.id, rulesetId: ruleset.id }, 'Failed to run ruleset');
		return { matches: [], allNearby: [], failed: true };
	}
}

/**
 * The interactive map's search area - the site grown by the nearby radius - with every nearby
 * consultee and ruleset match clipped to it. The map is an extra: if this fails, the page still
 * lists every consultee in its tables.
 */
async function buildSearchAreaSafely(
	db: ManageService['db'],
	project: CaseBoundaryFeature,
	matches: ConsulteeAreaMatch[],
	nearby: ConsulteeAreaSummaryMatch[],
	nearbyRadiusMetres: number,
	logger: ManageService['logger']
): Promise<SearchAreaDisplay | undefined> {
	if (nearby.length === 0 && matches.length === 0) {
		return undefined;
	}
	try {
		const area = await bufferGeometryForDisplay(db, project.geometry, nearbyRadiusMetres);
		const ids = [...new Set([...nearby, ...matches].map((match) => match.feature.id))];
		const radiusKm = nearbyRadiusMetres / 1000;
		return {
			area,
			areaLabel: `Search area (${radiusKm}km)`,
			nearbyLabel: `All consultees within ${radiusKm}km`,
			nearby,
			geometries: await getConsulteeAreaDisplayGeometries(db, ids, area)
		};
	} catch (error) {
		logger.error({ error, caseId: project.id }, 'Failed to build the map search area');
		return undefined;
	}
}

function resultsUrl(caseId: string, rulesetId: string): string {
	return `/consultees/${encodeURIComponent(caseId)}/results?ruleset=${encodeURIComponent(rulesetId)}`;
}

function toMatchRow(match: ConsulteeAreaSummaryMatch): ConsulteeMatchRow {
	return {
		consultee: match.feature.properties.consultee ?? null,
		consulteeCategory: match.feature.properties.consulteeCategory ?? null,
		region: match.feature.properties.region ?? null,
		distanceMetres: Math.round(match.distanceMetres)
	};
}

/**
 * Step 3 of the identify-consultees flow: run the chosen ruleset against the chosen project and
 * show the matching consultees, on a map and in a table.
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
		const map = buildCaseMapConfig(project, matches, ruleset.name, searchArea);

		const viewModel: ConsulteesResultsViewModel = {
			pageHeading: `Consultees identified for ${project.properties.caseName} (${project.properties.caseReference})`,
			backLinkUrl: `/consultees/${project.id}`,
			rulesetName: ruleset.name,
			reference: project.properties.caseReference,
			caseName: project.properties.caseName,
			caseId: project.id,
			mapId: 'case-map',
			mapRegionLabel: `Map showing ${ruleset.name} for ${project.properties.caseName}`,
			staticMapSrc: `/consultees/${encodeURIComponent(project.id)}/results/static-map?ruleset=${encodeURIComponent(ruleset.id)}`,
			rulesetFailed: failed,
			retryUrl: resultsUrl(project.id, ruleset.id),
			staticMapAlt: `Static map showing ${ruleset.name} for ${project.properties.caseName}`,
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
		// same search area as the interactive map, so both open on the same view - the static renderer
		// draws the project and matches only, not the nearby layer
		const searchArea = await buildSearchAreaSafely(
			db,
			project,
			matches,
			allNearby,
			nearbyConsulteeRadiusMetres,
			logger
		);
		const map = buildCaseMapConfig(project, matches, ruleset.name, searchArea);
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
