import type { ManageService } from '#service';
import { findConsulteeAreaByName } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import { isIdentified } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler, AsyncRequestHandlerWithBody } from '@planning-inspectorate/core/util';
import type { Response } from 'express';
import { consulteeName } from '../../report-consultees.ts';
import type { AddedConsultee } from '../../urls.ts';
import { addConsulteeUrl, consulteesUrl, excludedMatchIds } from '../../urls.ts';
import type { CategoryContext } from '../controller.ts';
import { categoryContext, comparableName, kilometresFromSite, nearbyCandidates } from '../controller.ts';
import type { AddConsulteeForm, AddConsulteeViewModel } from './view-model.ts';

const VIEW = 'views/consultees/report/consultees/add/view.njk';

/** The page, with the form's entered values and errors if a submit failed. */
function renderAddPage(
	res: Response,
	context: CategoryContext,
	form: AddConsulteeForm = { nameValue: '', reasonValue: '' }
): void {
	const { project, ruleset, category, selection } = context;

	// one suggestion per name, at its nearest - a typed name is matched to the nearest of that name
	const suggestions = new Map<string, { name: string; hint: string }>();
	for (const match of nearbyCandidates(context)) {
		const name = consulteeName(match);
		if (!suggestions.has(comparableName(name))) {
			suggestions.set(comparableName(name), { name, hint: kilometresFromSite(match.distanceMetres) });
		}
	}

	const errorSummary = [
		...(form.nameError ? [{ text: form.nameError.text, href: '#consultee-name' }] : []),
		...(form.reasonError ? [{ text: form.reasonError.text, href: '#consultee-reason' }] : [])
	];
	const viewModel: AddConsulteeViewModel = {
		pageHeading: 'Add a consultee',
		pageCaption: category,
		backLinkUrl: consulteesUrl(project.id, ruleset.id, category, selection),
		formAction: addConsulteeUrl(project.id, ruleset.id, category, selection),
		nearbySuggestions: [...suggestions.values()],
		addForm: form,
		...(errorSummary.length ? { errorSummary } : {})
	};
	res.render(VIEW, viewModel);
}

/**
 * The "Add a consultee" page a category page's Add consultee link opens: a name - matched to the
 * category's consultees only the nearby search found (the faint ones on its map) as it's typed,
 * via the datalist consultee-autocomplete.js enhances - and a reason. It shares the category
 * page's ruleset semantics, so a case, ruleset or category it would 404 is a 404 here too.
 */
export function buildReportConsulteeAddPage(service: ManageService): AsyncRequestHandler {
	return async (req, res) => {
		const context = await categoryContext(service, req, res);
		if (context) {
			renderAddPage(res, context);
		}
	};
}

/** Why a name was refused: it isn't a consultee of the category in the reference data. */
export function notAConsulteeError(name: string, category: string): string {
	return `${name} does not exist as a ${category} consultee. Enter a valid consultee.`;
}

/**
 * Saves a hand-added consultee. The name and the reason are both required - like the removal
 * reason, the reason is recorded for auditing and shows in the Identified column. The name has to
 * be a real consultee of the category: one of its nearby consultees (case and spacing aside, the
 * nearest of that name), so the maps draw it as identified, or any other in the reference data
 * (the nearest of that name to the site), so the report has its stored row. Anything else - a
 * typo, or a made-up name - is refused, as is a name already listed. A failed submit shows the page
 * again with the entered values and an error per field; a successful one adds the consultee to the
 * URL's `add` params and returns to the category page.
 */
export function buildReportConsulteeAddSubmit(
	service: ManageService
): AsyncRequestHandlerWithBody<{ name?: unknown; reason?: unknown }> {
	return async (req, res) => {
		const context = await categoryContext(service, req, res);
		if (!context) {
			return;
		}
		const { project, ruleset, category, selection, consultees } = context;

		const nameValue = typeof req.body?.name === 'string' ? req.body.name : '';
		const reasonValue = typeof req.body?.reason === 'string' ? req.body.reason : '';
		const name = nameValue.trim().replace(/\s+/g, ' ');
		const reason = reasonValue.trim();

		const excluded = excludedMatchIds(selection.removed);
		const listed = [
			...consultees
				.filter(
					(match) =>
						match.feature.properties.consulteeCategory === category &&
						isIdentified(match) &&
						!excluded.has(match.feature.id)
				)
				.map(consulteeName),
			...selection.adds.filter((add) => add.category === category).map((add) => add.name)
		].map(comparableName);
		// the nearest consultee of that name: nearby (candidates come nearest first), else anywhere in
		// the reference data - looked up only for a name that's given and not already listed
		const alreadyListed = listed.includes(comparableName(name));
		const nearby = nearbyCandidates(context).find(
			(candidate) => comparableName(consulteeName(candidate)) === comparableName(name)
		);
		const stored =
			!name || alreadyListed
				? undefined
				: nearby
					? { id: nearby.feature.id, consultee: consulteeName(nearby) }
					: await findConsulteeAreaByName(service.db, category, name, project.geometry);

		const nameError = !name
			? 'Enter the consultee name'
			: alreadyListed
				? `${name} is already listed in ${category}`
				: !stored
					? notAConsulteeError(name, category)
					: undefined;
		const reasonError = reason ? undefined : 'Enter a reason for adding this consultee.';
		// no consultee found always comes with a name error
		if (!stored || reasonError) {
			return renderAddPage(res, context, {
				nameValue,
				reasonValue,
				...(nameError ? { nameError: { text: nameError } } : {}),
				...(reasonError ? { reasonError: { text: reasonError } } : {})
			});
		}

		const add: AddedConsultee = { id: stored.id, category, name: stored.consultee, reason };
		return res.redirect(
			`${consulteesUrl(project.id, ruleset.id, category, { removed: selection.removed, adds: [...selection.adds, add] })}#consultees`
		);
	};
}
