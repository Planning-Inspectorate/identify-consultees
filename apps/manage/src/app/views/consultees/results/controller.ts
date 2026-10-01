import type { ManageService } from '#service';
import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { ConsulteeAreaMatch } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import type { Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { getRuleset, runRuleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
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

async function runRulesetSafely(
	db: ManageService['db'],
	project: CaseBoundaryFeature,
	ruleset: Ruleset,
	logger: ManageService['logger']
): Promise<ConsulteeAreaMatch[]> {
	try {
		return await runRuleset(db, project.geometry, ruleset);
	} catch (error) {
		logger.error({ error, caseId: project.id, rulesetId: ruleset.id }, 'Failed to run ruleset');
		return [];
	}
}

function toMatchRow(match: ConsulteeAreaMatch): ConsulteeMatchRow {
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
	const { db, logger } = service;

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

		const matches = await runRulesetSafely(db, project, ruleset, logger);
		const map = buildCaseMapConfig(project, matches, ruleset.name);

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
			staticMapAlt: `Static map showing ${ruleset.name} for ${project.properties.caseName}`,
			mapWidth: MAP_VIEWPORT.width,
			mapHeight: MAP_VIEWPORT.height,
			mapConfigJson: JSON.stringify(map),
			matches: matches.map(toMatchRow),
			matchCount: map.matchCount,
			mapIsSampled: map.isSampled,
			mapSampleSize: MAX_SAMPLED_MAP_MATCHES
		};

		return res.render('views/consultees/results/view.njk', viewModel);
	};
}

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

		const matches = await runRulesetSafely(db, project, ruleset, logger);
		const map = buildCaseMapConfig(project, matches, ruleset.name);
		const ifNoneMatch = typeof req.headers['if-none-match'] === 'string' ? req.headers['if-none-match'] : undefined;

		const image = await buildConsulteeStaticMapResponse({
			geometryId: project.id,
			sectionId: ruleset.id,
			map,
			forceSvg,
			ifNoneMatch
		});

		res
			.status(image.status)
			.set({
				'Cache-Control': image.cacheControl,
				ETag: image.etag
			})
			.type(image.contentType);

		if (image.status === 304) {
			res.end();
			return;
		}

		res.send(image.body);
	};
}
