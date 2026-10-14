import type { ManageService } from '#service';
import { stringifyForInlineScript } from '#util/inline-json.ts';
import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { ConsulteeMatch, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import {
	getRuleset,
	isIdentifiedByCondition,
	RULESETS
} from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import type { Request, Response } from 'express';
import { buildCaseMapConfig, markAddedByHand, MAX_SAMPLED_MAP_MATCHES } from '../../../../maps/case-geojson.ts';
import { MAP_VIEWPORT } from '../../../../maps/sample-geojson.ts';
import { describeReasons } from '../../reasons.ts';
import { resolveCase } from '../../resolve-case.ts';
import { buildSearchAreaSafely, firstQueryValue, runRulesetSafely } from '../../run-ruleset.ts';
import { rulesetCategories } from '../categories.ts';
import { addedConsulteeReason, consulteeName } from '../report-consultees.ts';
import type { ConsulteeSelection } from '../urls.ts';
import {
	addConsulteeUrl,
	addedMatchIds,
	categoryStaticMapUrl,
	consulteeSelection,
	consulteesUrl,
	excludedMatchIds,
	removeConsulteeUrl,
	reportUrl
} from '../urls.ts';
import type { ConsulteeRow, ReportConsulteesViewModel } from './view-model.ts';

const VIEW = 'views/consultees/report/consultees/view.njk';

/** A category page's case, ruleset, category, selection and run - everything both its handlers need. */
export interface CategoryContext {
	project: CaseBoundaryFeature;
	ruleset: Ruleset;
	category: string;
	selection: ConsulteeSelection;
	consultees: ConsulteeMatch[];
	failed: boolean;
}

/**
 * The case/ruleset/category a category page request targets, with the ruleset's run (kept in the
 * session - see runRulesetSafely). A case that isn't found, a ruleset that isn't known, or a
 * category the ruleset neither covers nor identified consultees in 404s - anything else has
 * nothing to change. A failed run can't tell, so it shows its error rather than a 404.
 * `undefined` means a response has already been sent.
 */
export async function categoryContext(
	service: ManageService,
	req: Request,
	res: Response
): Promise<CategoryContext | undefined> {
	const project = await resolveCase(service.db, String(req.params.caseId ?? ''));
	// same ruleset semantics as the map page: absent means the default, present-but-unknown 404s
	const requestedRuleset = firstQueryValue(req.query.ruleset);
	const ruleset = requestedRuleset ? getRuleset(requestedRuleset) : RULESETS[0];
	if (!project || !ruleset) {
		res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
		return undefined;
	}

	const category = firstQueryValue(req.query.category);
	const { consultees, failed } = await runRulesetSafely(
		service.rulesetRunner,
		project,
		ruleset,
		service.nearbyConsulteeRadiusMetres,
		service.logger,
		req.session
	);
	const found = consultees.some(
		(consultee) => consultee.feature.properties.consulteeCategory === category && isIdentifiedByCondition(consultee)
	);
	if (!failed && !found && !rulesetCategories(ruleset).includes(category)) {
		res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
		return undefined;
	}
	return { project, ruleset, category, selection: consulteeSelection(req.query), consultees, failed };
}

/**
 * The category's consultees only the nearby search found, nearest first, less any already added -
 * the ones a typed name is matched against (and the Add a consultee page suggests as it's typed).
 */
export function nearbyCandidates({ consultees, category, selection }: CategoryContext): ConsulteeMatch[] {
	const added = addedMatchIds(selection.adds);
	return consultees.filter(
		(match) =>
			match.feature.properties.consulteeCategory === category &&
			!isIdentifiedByCondition(match) &&
			!added.has(match.feature.id)
	);
}

/** A name as names are compared: case, and runs of spaces, ignored. */
export function comparableName(name: string): string {
	return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function kilometresFromSite(metres: number): string {
	return `${(metres / 1000).toFixed(1)} km from the site`;
}

/** The page: map, the category's identified consultees, and the removed-consultees section. */
async function renderCategoryPage(
	service: ManageService,
	req: Request,
	res: Response,
	context: CategoryContext
): Promise<void> {
	const { project, ruleset, category, selection, consultees, failed } = context;
	const excluded = excludedMatchIds(selection.removed);

	// the map shows the category's consultees the nearby search found too, fainter (see
	// case-geojson.ts) - what's nearby is useful context - but only identified ones are listed.
	// Nearby ones added by hand are drawn as identified
	const visible = consultees.filter(
		(match) => match.feature.properties.consulteeCategory === category && !excluded.has(match.feature.id)
	);
	const identified = visible.filter(isIdentifiedByCondition);
	const searchArea = await buildSearchAreaSafely(
		service.db,
		project,
		visible,
		service.nearbySearchRadiusMetres,
		service.logger
	);
	const staticMapSrc = categoryStaticMapUrl(project.id, ruleset.id, category, selection);
	const staticMapAlt = `Static map showing ${category} consultees for ${project.properties.caseName}`;
	const map = buildCaseMapConfig(
		project,
		markAddedByHand(visible, addedMatchIds(selection.adds)),
		category,
		searchArea,
		{ src: staticMapSrc, alt: staticMapAlt }
	);

	// ruleset matches first, then hand-added consultees - every Remove link opens the "Remove
	// consultee" page, which records the reason before excluding the match or dropping the add
	const rows: ConsulteeRow[] = [
		...identified.map((match) => ({
			name: consulteeName(match),
			identified: describeReasons(match, ruleset, { nearby: false }),
			removeUrl: removeConsulteeUrl(project.id, ruleset.id, category, { matchId: match.feature.id }, selection)
		})),
		...selection.adds.flatMap((add, index) => {
			if (add.category !== category) {
				return [];
			}
			return [
				{
					name: add.name,
					identified: [addedConsulteeReason(add)],
					removeUrl: removeConsulteeUrl(project.id, ruleset.id, category, { addedIndex: index }, selection)
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
		// this category's recorded removals, for the expandable Removed consultees section -
		// ?removed=open (where a successful removal redirects) opens it
		removedRows: selection.removed
			.filter((removal) => removal.category === category && removal.name !== '')
			.map((removal) => ({ name: removal.name, reason: removal.reason })),
		removedOpen: firstQueryValue(req.query.removed) === 'open',
		rulesetFailed: failed,
		retryUrl: consulteesUrl(project.id, ruleset.id, category, selection),
		matchCount: map.matchCount,
		mapIsSampled: map.isSampled,
		mapSampleSize: MAX_SAMPLED_MAP_MATCHES
	};

	res.render(VIEW, viewModel);
}

/**
 * A check-page category's Change page: the consultees the ruleset identified in that category,
 * mapped and listed, each with a Remove link to the "Remove consultee" page (which records the
 * reason for the removal), then any added by hand. The "Add a consultee" page (see add/) adds a
 * consultee by a typed name, matched to the category's nearby consultees as it's typed.
 * The whole selection lives in the URL (see urls.ts), so the check page's counts stay in step.
 * "Save and return" goes back to the check page.
 */
export function buildReportConsulteesPage(service: ManageService): AsyncRequestHandler {
	return async (req, res) => {
		const context = await categoryContext(service, req, res);
		if (context) {
			await renderCategoryPage(service, req, res, context);
		}
	};
}
