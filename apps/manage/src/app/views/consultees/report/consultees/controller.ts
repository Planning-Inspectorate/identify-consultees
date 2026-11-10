import type { ManageService } from '#service';
import { stringifyForInlineScript } from '#util/inline-json.ts';
import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { ConsulteeMatch, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { isIdentified } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import type { Request, Response } from 'express';
import type { MapMatch } from '../../../../maps/case-geojson.ts';
import { addedBeyondRun, buildCaseMapConfig, markAddedByHand } from '../../../../maps/case-geojson.ts';
import { MAP_VIEWPORT } from '../../../../maps/sample-geojson.ts';
import { categorySettings } from '../../../../report-config.ts';
import { labelsWithReferenceData } from '../../consultee-labels.ts';
import { NEARBY_NSIPS } from '../../nearby-nsips.ts';
import { describeReasons } from '../../reasons.ts';
import { resolveCase } from '../../resolve-case.ts';
import { buildSearchAreaSafely, firstQueryValue, requestedRuleset, runRulesetSafely } from '../../run-ruleset.ts';
import { categoryBufferMetres, siteBufferGeojson, siteBuffers } from '../../site-buffers.ts';
import { categoryDisplayName, rulesetCategories } from '../categories.ts';
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
	/** True when the site was screened against its bounding box - the list needs reviewing. */
	screenedBoundingBox: boolean;
}

/**
 * The case/ruleset/category a category page request targets, with the ruleset's run (kept in the
 * session - see runRulesetSafely). A case that isn't found, a ruleset that isn't known, or a
 * category the ruleset neither covers nor identified consultees in 404s - anything else has
 * nothing to change. Nearby NSIPs, while they're looked for, has a page whether or not any were found. A failed run can't tell, so it shows its error rather than a 404.
 * `undefined` means a response has already been sent.
 */
export async function categoryContext(
	service: ManageService,
	req: Request,
	res: Response
): Promise<CategoryContext | undefined> {
	const project = await resolveCase(service.db, String(req.params.caseId ?? ''));
	const ruleset = requestedRuleset(req.query.ruleset);
	if (!project || !ruleset) {
		res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
		return undefined;
	}

	const category = firstQueryValue(req.query.category);
	const { consultees, failed, siteScreenedAs } = await runRulesetSafely(service, project, ruleset, req.session);
	const found = consultees.some(
		(consultee) => consultee.feature.properties.consulteeCategory === category && isIdentified(consultee)
	);
	const nearbyNsips = category === NEARBY_NSIPS && service.nearbyNsipRadiusMetres > 0;
	if (!failed && !found && !nearbyNsips && !rulesetCategories(ruleset).includes(category)) {
		res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
		return undefined;
	}
	return {
		project,
		ruleset,
		category,
		selection: consulteeSelection(req.query),
		consultees,
		failed,
		screenedBoundingBox: siteScreenedAs === 'boundingBox'
	};
}

/**
 * The category's consultees only the nearby search found, nearest first, less any already added -
 * the ones a typed name is matched against (and the Add a consultee page suggests as it's typed).
 */
export function nearbyCandidates({ consultees, category, selection }: CategoryContext): ConsulteeMatch[] {
	const added = addedMatchIds(selection.adds);
	return consultees.filter(
		(match) =>
			match.feature.properties.consulteeCategory === category && !isIdentified(match) && !added.has(match.feature.id)
	);
}

// how names are compared, and distances given - shared with the add page's labels
export { comparableName, kilometresFromSite } from '../../consultee-labels.ts';

/**
 * Each listed consultee's name, by id - those sharing a name, with another in the list or in the
 * reference data, with what tells them apart (consultee-labels.ts). Nearby NSIPs' names carry their
 * case reference already.
 */
async function listLabels(
	service: ManageService,
	category: string,
	rows: { id: string; name: string; distanceMetres?: number }[]
): Promise<Map<string, string>> {
	return (await labelsWithReferenceData(service.db, category, category !== NEARBY_NSIPS, rows)).labels;
}

/** `matches` named as `labels` has them - "Newton (Ribble Valley)" - for the map. */
function labelledMatches(matches: MapMatch[], labels: ReadonlyMap<string, string>): MapMatch[] {
	return matches.map((match) => {
		const label = labels.get(match.feature.id);
		return label === undefined || label === match.feature.properties.consultee
			? match
			: { ...match, feature: { ...match.feature, properties: { ...match.feature.properties, consultee: label } } };
	});
}

/** The page: map, the category's identified consultees, and the removed-consultees section. */
async function renderCategoryPage(
	service: ManageService,
	req: Request,
	res: Response,
	context: CategoryContext
): Promise<void> {
	const { project, ruleset, category, consultees, failed, screenedBoundingBox } = context;
	const selection = context.selection;
	const excluded = excludedMatchIds(selection.removed);

	// the map shows the category's consultees the nearby search found too, fainter (see
	// case-geojson.ts) - what's nearby is useful context - but only identified ones are listed.
	// Nearby ones added by hand are drawn as identified
	const visible = consultees.filter(
		(match) => match.feature.properties.consulteeCategory === category && !excluded.has(match.feature.id)
	);
	const identified = visible.filter(isIdentified);
	// and the ones added by hand from further away than the run looked
	const drawn = [
		...markAddedByHand(visible, addedMatchIds(selection.adds)),
		...addedBeyondRun(consultees, selection.adds, category)
	];
	const searchArea = await buildSearchAreaSafely(
		service.db,
		project,
		drawn,
		service.nearbySearchRadiusMetres,
		service.logger
	);
	const categoryName = categoryDisplayName(category);
	const staticMapSrc = categoryStaticMapUrl(project.id, ruleset.id, category, selection);
	const staticMapAlt = `Static map showing ${categoryName} consultees for ${project.properties.caseName}`;
	// the ruleset's buffers for the category around the site, as the report's map draws them
	const buffers = await siteBuffers(
		service,
		project,
		screenedBoundingBox ? 'boundingBox' : 'outline',
		categoryBufferMetres(ruleset, category, service.nearbyNsipRadiusMetres)
	);
	// consultees alphabetically by name, ruleset matches and hand-added ones together - every
	// Remove link opens the "Remove consultee" page, which records the reason before excluding
	// the match or dropping the add
	const listedRows = [
		...identified.map((match) => ({
			id: match.feature.id,
			name: consulteeName(match),
			distanceMetres: match.distanceMetres,
			identified: describeReasons(match, ruleset, { nearby: false }),
			removeUrl: removeConsulteeUrl(project.id, ruleset.id, category, { matchId: match.feature.id }, selection)
		})),
		...selection.adds.flatMap((add, index) => {
			if (add.category !== category) {
				return [];
			}
			// one the run found has its distance; one added from further away, or by name alone, none
			const found = add.id ? consultees.find((match) => match.feature.id === add.id) : undefined;
			return [
				{
					id: add.id ?? `added-${index}`,
					name: add.name,
					...(found ? { distanceMetres: found.distanceMetres } : {}),
					identified: [addedConsulteeReason(add)],
					removeUrl: removeConsulteeUrl(project.id, ruleset.id, category, { addedIndex: index }, selection)
				}
			];
		})
	];
	// two of the same name - two Middletons - each read with what tells it apart (consultee-labels.ts),
	// on the map as in the list. The map's fainter nearby ones count too: a Newton listed beside one
	// only mapped is told apart from it
	const listedIds = new Set(listedRows.map(({ id }) => id));
	const mappedOnly = drawn
		.filter((match) => !listedIds.has(match.feature.id))
		.map((match) => ({ id: match.feature.id, name: consulteeName(match), distanceMetres: match.distanceMetres }));
	const labels = await listLabels(service, category, [...listedRows, ...mappedOnly]);
	const map = {
		...buildCaseMapConfig(
			project,
			labelledMatches(drawn, labels),
			category,
			searchArea,
			{ src: staticMapSrc, alt: staticMapAlt },
			categorySettings(category).mapMarginMetres
		),
		...(buffers.length > 0 ? { bufferGeojson: siteBufferGeojson(buffers) } : {})
	};
	const rows: ConsulteeRow[] = listedRows
		.map(({ id, identified: reasons, removeUrl }) => ({ name: labels.get(id)!, identified: reasons, removeUrl }))
		.sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));

	const viewModel: ReportConsulteesViewModel = {
		pageHeading: categoryName,
		pageCaption: project.properties.caseName,
		backLinkUrl: reportUrl(project.id, ruleset.id, selection),
		backLinkText: 'Back to draft report',
		rows,
		addConsulteeUrl: addConsulteeUrl(project.id, ruleset.id, category, selection),
		mapId: 'case-map',
		mapRegionLabel: `Map showing ${categoryName} consultees for ${project.properties.caseName}`,
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
		screenedBoundingBox,
		retryUrl: consulteesUrl(project.id, ruleset.id, category, selection)
	};

	res.render(VIEW, viewModel);
}

/**
 * A check-page category's Change page: the consultees the ruleset identified in that category,
 * mapped and listed, each with a Remove link to the "Remove consultee" page (which records the
 * reason for the removal), then any added by hand. The "Add a consultee" page (see add/) adds a
 * consultee by a typed name, matched to the category's nearby consultees as it's typed.
 * The whole selection lives in the URL (see urls.ts), so the check page's counts stay in step.
 * Changes are kept as they're made - "Back to draft report" returns to the check page with them.
 */
export function buildReportConsulteesPage(service: ManageService): AsyncRequestHandler {
	return async (req, res) => {
		const context = await categoryContext(service, req, res);
		if (context) {
			await renderCategoryPage(service, req, res, context);
		}
	};
}
