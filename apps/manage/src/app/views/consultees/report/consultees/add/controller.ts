import type { ManageService } from '#service';
import { isIdentifiedByCondition } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
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

/**
 * Saves a hand-added consultee. The name and the reason are both required - like the removal
 * reason, the reason is recorded for auditing and shows in the Identified column. A name matching
 * one of the category's nearby consultees (case and spacing aside) adds that consultee, by its id,
 * so the maps draw it as identified and the report has its stored row; any other name is added as
 * typed, with no area to map. A name already listed is refused. A failed submit shows the page
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
						isIdentifiedByCondition(match) &&
						!excluded.has(match.feature.id)
				)
				.map(consulteeName),
			...selection.adds.filter((add) => add.category === category).map((add) => add.name)
		].map(comparableName);
		const nameError = !name
			? 'Enter the consultee name'
			: listed.includes(comparableName(name))
				? `${name} is already listed in ${category}`
				: undefined;
		const reasonError = reason ? undefined : 'Enter a reason for adding this consultee.';
		if (nameError || reasonError) {
			return renderAddPage(res, context, {
				nameValue,
				reasonValue,
				...(nameError ? { nameError: { text: nameError } } : {}),
				...(reasonError ? { reasonError: { text: reasonError } } : {})
			});
		}

		// candidates come nearest first, so a name shared by several is matched to the nearest
		const match = nearbyCandidates(context).find(
			(candidate) => comparableName(consulteeName(candidate)) === comparableName(name)
		);
		const add: AddedConsultee = match
			? { id: match.feature.id, category, name: consulteeName(match), reason }
			: { category, name, reason };
		return res.redirect(
			`${consulteesUrl(project.id, ruleset.id, category, { removed: selection.removed, adds: [...selection.adds, add] })}#consultees`
		);
	};
}
