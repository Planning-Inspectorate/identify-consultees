import type { ManageService } from '#service';
import { stringifyForInlineScript } from '#util/inline-json.ts';
import type { ConsulteeAreaMatch } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import { DISTANCE_MARGIN_METRES } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import type { RuleCondition, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { getRuleset, RULESETS } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { buildCaseMapConfig, MAX_SAMPLED_MAP_MATCHES } from '../../../../maps/case-geojson.ts';
import { MAP_VIEWPORT } from '../../../../maps/sample-geojson.ts';
import { resolveCase } from '../../resolve-case.ts';
import { buildSearchAreaSafely, firstQueryValue, runRulesetSafely } from '../../run-ruleset.ts';
import { rulesetCategories } from '../categories.ts';
import type { ConsulteeSelection } from '../urls.ts';
import {
	addConsulteeUrl,
	addedConsultees,
	categoryStaticMapUrl,
	consulteesUrl,
	excludedIds,
	reportUrl
} from '../urls.ts';
import type { ConsulteeRow, ReportConsulteesViewModel } from './view-model.ts';

/**
 * RuleCondition declares `bufferMetres` optional because only intersection conditions carry one -
 * narrowing on logicType reflects that, rather than sprinkling `?? 0` where it can never fall back.
 */
function isIntersectionRule(rule: RuleCondition): rule is RuleCondition & { bufferMetres: number } {
	return rule.logicType === 'intersection';
}

/**
 * How the ruleset identified this match: the smallest intersection buffer it sits inside ("Within
 * 1km buffer"), "Intersects the site" for a zero-buffer rule, or - when no intersection rule's
 * reach covers it, meaning a bordering condition found it - that condition's own description.
 */
function identifiedBy(match: ConsulteeAreaMatch, ruleset: Ruleset, category: string): string {
	const rules = ruleset.rules.filter((rule) => rule.categories.includes(category));
	const intersecting = rules
		.filter(isIntersectionRule)
		.filter((rule) => match.distanceMetres <= rule.bufferMetres + DISTANCE_MARGIN_METRES)
		.sort((a, b) => a.bufferMetres - b.bufferMetres);
	if (intersecting.length > 0) {
		const bufferMetres = intersecting[0].bufferMetres;
		return bufferMetres > 0 ? `Within ${bufferMetres / 1000}km buffer` : 'Intersects the site';
	}
	return rules.find((rule) => rule.logicType === 'bordering')?.name ?? '';
}

/**
 * A check-page category's Change page: the consultees the ruleset identified in that category,
 * mapped and listed, each with a Remove link that excludes it. Consultees added by hand on the
 * linked "Add consultee" page appear after the ruleset's matches. The whole selection lives in
 * the URL (see urls.ts), so the check page's counts stay in step. "Save and return" goes back to
 * the check page.
 */
export function buildReportConsulteesPage(service: ManageService): AsyncRequestHandler {
	const { db, logger, nearbyConsulteeRadiusMetres } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const project = await resolveCase(db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		// same ruleset semantics as the map page: absent means the default, present-but-unknown 404s
		const requestedRuleset = firstQueryValue(req.query.ruleset);
		const ruleset = requestedRuleset ? getRuleset(requestedRuleset) : RULESETS[0];
		if (!ruleset) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		// a category the ruleset doesn't cover isn't a page - there'd be nothing to change
		const category = firstQueryValue(req.query.category);
		if (!rulesetCategories(ruleset).includes(category)) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		const excluded = excludedIds(req.query.exclude);
		const adds = addedConsultees(req.query.add);
		const selection: ConsulteeSelection = { excluded, adds };
		const { matches, failed } = await runRulesetSafely(db, project, ruleset, nearbyConsulteeRadiusMetres, logger);
		const visible = matches.filter(
			(match) => match.feature.properties.consulteeCategory === category && !excluded.has(match.feature.id)
		);
		const searchArea = await buildSearchAreaSafely(db, project, visible, [], nearbyConsulteeRadiusMetres, logger);
		const staticMapSrc = categoryStaticMapUrl(project.id, ruleset.id, category, selection);
		const staticMapAlt = `Static map showing ${category} consultees for ${project.properties.caseName}`;
		const map = buildCaseMapConfig(project, visible, category, searchArea, { src: staticMapSrc, alt: staticMapAlt });

		// ruleset matches first, then hand-added consultees (each removable by dropping its add
		// param - removal by index so duplicate entries each get their own link)
		const rows: ConsulteeRow[] = [
			...visible.map((match) => ({
				name: match.feature.properties.consultee ?? 'Unnamed consultee',
				identified: identifiedBy(match, ruleset, category),
				removeUrl: consulteesUrl(project.id, ruleset.id, category, {
					excluded: new Set([...excluded, match.feature.id]),
					adds
				})
			})),
			...adds.flatMap((add, index) => {
				if (add.category !== category) {
					return [];
				}
				return [
					{
						name: add.name,
						identified: add.reason || 'Manually added',
						removeUrl: consulteesUrl(project.id, ruleset.id, category, {
							excluded,
							adds: adds.filter((_, i) => i !== index)
						})
					}
				];
			})
		];

		const viewModel: ReportConsulteesViewModel = {
			pageHeading: category,
			pageCaption: project.properties.caseName,
			backLinkUrl: reportUrl(project.id, ruleset.id, selection),
			rows,
			addConsulteeUrl: addConsulteeUrl(project.id, ruleset.id, category, selection),
			saveAndReturnUrl: reportUrl(project.id, ruleset.id, selection),
			mapId: 'case-map',
			mapRegionLabel: `Map showing ${category} consultees for ${project.properties.caseName}`,
			staticMapSrc,
			staticMapAlt,
			mapWidth: MAP_VIEWPORT.width,
			mapHeight: MAP_VIEWPORT.height,
			mapConfigJson: stringifyForInlineScript(map),
			rulesetFailed: failed,
			retryUrl: consulteesUrl(project.id, ruleset.id, category, selection),
			matchCount: map.matchCount,
			mapIsSampled: map.isSampled,
			mapSampleSize: MAX_SAMPLED_MAP_MATCHES
		};

		return res.render('views/consultees/report/consultees/view.njk', viewModel);
	};
}
