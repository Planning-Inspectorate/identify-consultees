import type { ManageService } from '#service';
import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import { listConsulteeCategories } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import type { ConsulteeMatch, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import {
	getRuleset,
	isIdentifiedByCondition,
	RULESETS
} from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler, AsyncRequestHandlerWithBody } from '@planning-inspectorate/core/util';
import type { Response } from 'express';
import { resolveCase } from '../../../resolve-case.ts';
import type { RulesetRunStore } from '../../../run-ruleset.ts';
import { firstQueryValue, runRulesetSafely } from '../../../run-ruleset.ts';
import { rulesetCategories } from '../../categories.ts';
import { consulteeName } from '../../report-consultees.ts';
import type { ConsulteeSelection } from '../../urls.ts';
import { addConsulteeUrl, addedMatchIds, consulteeSelection, consulteesUrl } from '../../urls.ts';
import type { AddConsulteeViewModel } from './view-model.ts';

/** The radio value for a consultee that isn't one of the nearby ones listed - its name is typed in. */
export const NOT_LISTED = 'not-listed';

interface AddConsulteeContext {
	project: CaseBoundaryFeature;
	ruleset: Ruleset;
	category: string;
	selection: ConsulteeSelection;
	/**
	 * The category's consultees only the nearby search found, nearest first, less any already added -
	 * the ones a user can pick. Empty when the ruleset couldn't be run: a name can still be typed.
	 */
	nearby: ConsulteeMatch[];
}

/**
 * The case/ruleset/category an "Add consultee" request targets, since this form lives under a
 * category page: a case that isn't found, a ruleset that isn't known, or a category that's neither
 * one the ruleset covers nor one in the reference data (the nearby search finds those) 404s. `undefined` means a response has
 * already been sent.
 */
async function addConsulteeContext(
	service: ManageService,
	caseId: string,
	query: Record<string, unknown>,
	res: Response,
	store?: RulesetRunStore
): Promise<AddConsulteeContext | undefined> {
	const project = await resolveCase(service.db, caseId);
	if (!project) {
		res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
		return undefined;
	}
	const requestedRuleset = firstQueryValue(query.ruleset);
	const ruleset = requestedRuleset ? getRuleset(requestedRuleset) : RULESETS[0];
	const category = firstQueryValue(query.category);
	const knownCategory =
		ruleset !== undefined &&
		(rulesetCategories(ruleset).includes(category) || (await listConsulteeCategories(service.db)).includes(category));
	if (!ruleset || !knownCategory) {
		res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
		return undefined;
	}
	const selection = consulteeSelection(query);
	const { consultees } = await runRulesetSafely(
		service.rulesetRunner,
		project,
		ruleset,
		service.nearbyConsulteeRadiusMetres,
		service.logger,
		store
	);
	const added = addedMatchIds(selection.adds);
	const nearby = consultees.filter(
		(match) =>
			match.feature.properties.consulteeCategory === category &&
			!isIdentifiedByCondition(match) &&
			!added.has(match.feature.id)
	);
	return { project, ruleset, category, selection, nearby };
}

function kilometresFromSite(metres: number): string {
	return `${(metres / 1000).toFixed(1)} km from the site`;
}

interface EnteredValues {
	consultee?: string;
	name?: string;
	reason?: string;
}

interface AddErrors {
	consultee?: string;
	name?: string;
	reason?: string;
}

function viewModel(
	{ project, ruleset, category, selection, nearby }: AddConsulteeContext,
	entered: EnteredValues = {},
	errors: AddErrors = {}
): AddConsulteeViewModel {
	// the summary lists errors in the order the fields appear on the page
	const errorSummary = [
		...(errors.consultee ? [{ text: errors.consultee, href: '#consultee' }] : []),
		...(errors.name ? [{ text: errors.name, href: '#consultee-name' }] : []),
		...(errors.reason ? [{ text: errors.reason, href: '#consultee-reason' }] : [])
	];
	return {
		pageHeading: 'Add consultee',
		pageCaption: category,
		backLinkUrl: consulteesUrl(project.id, ruleset.id, category, selection),
		formAction: addConsulteeUrl(project.id, ruleset.id, category, selection),
		nearbyOptions: nearby.map((match) => ({
			value: match.feature.id,
			text: consulteeName(match),
			hint: { text: kilometresFromSite(match.distanceMetres) },
			checked: entered.consultee === match.feature.id
		})),
		notListedValue: NOT_LISTED,
		notListedChecked: entered.consultee === NOT_LISTED,
		nameValue: entered.name ?? '',
		reasonValue: entered.reason ?? '',
		...(errors.consultee ? { consulteeError: { text: errors.consultee } } : {}),
		...(errors.name ? { nameError: { text: errors.name } } : {}),
		...(errors.reason ? { reasonError: { text: errors.reason } } : {}),
		...(errorSummary.length ? { errorSummary } : {})
	};
}

/**
 * The "Add consultee" form a category page's "Add consultee" button opens: the category's
 * consultees the nearby search found (the faint ones on its map) to pick from, or one not listed by
 * name, and a reason. Saving adds the consultee to the URL's `add` params and returns to the
 * category page, where it's listed below the map - and, if it was picked, drawn on the map as
 * identified.
 */
export function buildReportConsulteeAddPage(service: ManageService): AsyncRequestHandler {
	return async (req, res) => {
		const context = await addConsulteeContext(service, String(req.params.caseId ?? ''), req.query, res, req.session);
		if (!context) {
			return;
		}
		return res.render('views/consultees/report/consultees/add/view.njk', viewModel(context));
	};
}

/**
 * Saves a hand-added consultee: a picked nearby consultee (recorded by its id, so the maps can
 * draw it) or one typed in by name. Which one and the reason are both required - like the removal
 * reason, the reason is recorded for auditing and shows in the category page's Identified column -
 * so an incomplete submit re-renders the form with the entered values and a validation error per
 * missing field. With no nearby consultees to pick, the form is the name alone. On success the new
 * consultee joins the `add` params and the user lands back on the category page.
 */
export function buildReportConsulteeAddSubmit(
	service: ManageService
): AsyncRequestHandlerWithBody<{ consultee?: unknown; name?: unknown; reason?: unknown }> {
	return async (req, res) => {
		const context = await addConsulteeContext(service, String(req.params.caseId ?? ''), req.query, res, req.session);
		if (!context) {
			return;
		}
		const { project, ruleset, category, selection, nearby } = context;

		const entered: EnteredValues = {
			consultee: typeof req.body?.consultee === 'string' ? req.body.consultee : undefined,
			name: typeof req.body?.name === 'string' ? req.body.name : '',
			reason: typeof req.body?.reason === 'string' ? req.body.reason : ''
		};
		const reason = entered.reason!.trim();
		// with nothing to pick, the form is the name input alone - as if "not listed" were chosen
		const choice = nearby.length === 0 ? NOT_LISTED : entered.consultee;
		const picked = nearby.find((match) => match.feature.id === choice);
		const name = choice === NOT_LISTED ? entered.name!.trim() : '';

		const errors: AddErrors = {
			...(!picked && choice !== NOT_LISTED ? { consultee: 'Select the consultee to add' } : {}),
			...(choice === NOT_LISTED && !name ? { name: 'Enter the consultee name' } : {}),
			...(!reason ? { reason: 'Enter a reason for adding this consultee.' } : {})
		};
		if (Object.keys(errors).length > 0) {
			return res.render('views/consultees/report/consultees/add/view.njk', viewModel(context, entered, errors));
		}

		const add = picked
			? { id: picked.feature.id, category, name: consulteeName(picked), reason }
			: { category, name, reason };
		const adds = [...selection.adds, add];
		return res.redirect(consulteesUrl(project.id, ruleset.id, category, { removed: selection.removed, adds }));
	};
}
