import type { ManageService } from '#service';
import { findOtherCases } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import { findConsulteeAreaByName } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import { isIdentified } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler, AsyncRequestHandlerWithBody } from '@planning-inspectorate/core/util';
import type { Response } from 'express';
import { NEARBY_NSIPS, nearbyNsipName } from '../../../nearby-nsips.ts';
import { consulteeName } from '../../report-consultees.ts';
import { addConsulteeUrl, consulteesUrl, excludedMatchIds } from '../../urls.ts';
import type { CategoryContext } from '../controller.ts';
import { categoryContext, comparableName, kilometresFromSite, nearbyCandidates } from '../controller.ts';
import type { AddConsulteeForm, AddConsulteeViewModel } from './view-model.ts';

const VIEW = 'views/consultees/report/consultees/add/view.njk';

/** A name the form can add, as it's suggested and matched: `name` is what it's added as. */
interface NameCandidate {
	id: string;
	name: string;
	/** Every name it answers to - for a case, "Name (REF)" and each part alone. */
	aliases: string[];
	distanceMetres: number;
	/** One the category page removed - adding it back undoes the removal. */
	removed?: boolean;
}

/**
 * The names already in the category's list - its identified matches not removed, and its
 * hand-added names - as names are compared, for the "already listed" check and to keep the
 * suggestions to names not already there.
 */
function listedNames({ consultees, category, selection }: CategoryContext): string[] {
	const excluded = excludedMatchIds(selection.removed);
	return [
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
}

/** The category's consultees the ruleset identified and the category page removed - the ones that can be added back. */
function removedCandidates({ consultees, category, selection }: CategoryContext): NameCandidate[] {
	const excluded = excludedMatchIds(selection.removed);
	return consultees
		.filter(
			(match) =>
				match.feature.properties.consulteeCategory === category && isIdentified(match) && excluded.has(match.feature.id)
		)
		.map((match) => {
			const name = consulteeName(match);
			return { id: match.feature.id, name, aliases: [name], distanceMetres: match.distanceMetres, removed: true };
		});
}

/**
 * What a typed name is matched against: for a consultee category, the ones the category page
 * removed - so one can be added back - then its consultees only the nearby search found, nearest
 * first. Every nearby NSIP is already identified - they're all report content - so for Nearby NSIPs
 * the candidates are every other case instead (a removed one among them), named for its project and
 * case reference and answering to either alone.
 */
async function nameCandidates(service: ManageService, context: CategoryContext): Promise<NameCandidate[]> {
	if (context.category === NEARBY_NSIPS) {
		const excluded = excludedMatchIds(context.selection.removed);
		return (await findOtherCases(service.db, context.project.id)).map((other) => {
			const name = nearbyNsipName(other);
			return {
				id: other.id,
				name,
				aliases: [name, other.caseName, other.caseReference],
				distanceMetres: other.distanceMetres,
				removed: excluded.has(other.id)
			};
		});
	}
	return [
		...removedCandidates(context),
		...nearbyCandidates(context).map((match) => {
			const name = consulteeName(match);
			return { id: match.feature.id, name, aliases: [name], distanceMetres: match.distanceMetres };
		})
	];
}

/** The page, with the form's entered values and errors if a submit failed. */
async function renderAddPage(
	res: Response,
	service: ManageService,
	context: CategoryContext,
	form: AddConsulteeForm = { nameValue: '', reasonValue: '' }
): Promise<void> {
	const { project, ruleset, category, selection } = context;

	// one suggestion per name, at its nearest - a typed name is matched to the nearest of that
	// name. Nearby NSIP candidates cover every other case, so the ones already listed are left
	// out of the suggestions (the nearby list only ever holds unlisted names)
	const listed = new Set(context.category === NEARBY_NSIPS ? listedNames(context) : []);
	const suggestions = new Map<string, { name: string; hint: string }>();
	for (const candidate of await nameCandidates(service, context)) {
		const key = comparableName(candidate.name);
		if (!suggestions.has(key) && !listed.has(key)) {
			suggestions.set(key, {
				name: candidate.name,
				hint: `${kilometresFromSite(candidate.distanceMetres)}${candidate.removed ? ', removed' : ''}`
			});
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
		nameHint:
			category === NEARBY_NSIPS
				? { text: 'Start typing to choose a national infrastructure project by its name or case reference.' }
				: suggestions.size
					? {
							text: `Start typing to choose a consultee you removed, or one near the site that the ruleset did not identify (shown faintly on the map). You can also enter any other ${category} consultee by its name.`
						}
					: undefined,
		addForm: form,
		...(errorSummary.length ? { errorSummary } : {})
	};
	res.render(VIEW, viewModel);
}

/**
 * The "Add a consultee" page a category page's Add consultee link opens: a name - matched to the
 * category's consultees only the nearby search found (the faint ones on its map) as it's typed,
 * via the datalist consultee-autocomplete.js enhances; for Nearby NSIPs, to the other cases -
 * and a reason. It shares the category page's ruleset semantics, so a case, ruleset or category
 * it would 404 is a 404 here too.
 */
export function buildReportConsulteeAddPage(service: ManageService): AsyncRequestHandler {
	return async (req, res) => {
		const context = await categoryContext(service, req, res);
		if (context) {
			await renderAddPage(res, service, context);
		}
	};
}

/**
 * Saves a hand-added consultee. The name and the reason are both required - like the removal
 * reason, the reason is recorded for auditing and shows in the Identified column. The name has to
 * be a real consultee of the category: one of the candidates it's matched to as it's typed (case
 * and spacing aside, the nearest of that name), so the report has its stored row - for a consultee
 * category, a nearby one or any other in the reference data; for Nearby NSIPs, another case's
 * newest shapefile. Anything else - a typo, or a made-up name - is refused, as is a name already
 * listed. A failed submit shows the page again with the entered values and an error per field; a
 * successful one adds the consultee to the URL's `add` params and returns to the category page.
 */
export function buildReportConsulteeAddSubmit(
	service: ManageService
): AsyncRequestHandlerWithBody<{ name?: unknown; reason?: unknown }> {
	return async (req, res) => {
		const context = await categoryContext(service, req, res);
		if (!context) {
			return;
		}
		const { project, ruleset, category, selection } = context;

		const nameValue = typeof req.body?.name === 'string' ? req.body.name : '';
		const reasonValue = typeof req.body?.reason === 'string' ? req.body.reason : '';
		const name = nameValue.trim().replace(/\s+/g, ' ');
		const reason = reasonValue.trim();

		const listed = listedNames(context);
		const candidates = await nameCandidates(service, context);
		// the nearest candidate of that name (candidates come nearest first): nearby for a
		// consultee category, another case for Nearby NSIPs
		const candidate = candidates.find((candidate) =>
			candidate.aliases.some((alias) => comparableName(alias) === comparableName(name))
		);
		// a typed name is refused as already listed whether it reaches the list directly or
		// through the canonical name of the candidate it resolves to
		const listedAs = listed.includes(comparableName(name))
			? name
			: candidate && listed.includes(comparableName(candidate.name))
				? candidate.name
				: undefined;
		// the stored row a matched candidate gives; for a consultee category an unmatched name can
		// still be a real consultee anywhere in the reference data - looked up only for a name
		// that's given and not already listed
		const stored =
			!name || listedAs
				? undefined
				: candidate
					? { id: candidate.id, consultee: candidate.name }
					: category === NEARBY_NSIPS
						? undefined
						: await findConsulteeAreaByName(service.db, category, name, project.geometry);

		const nameError = !name
			? 'Enter the consultee name'
			: listedAs
				? `${listedAs} is already listed in ${category}`
				: !stored
					? 'Consultee not found'
					: undefined;
		const reasonError = reason ? undefined : 'Enter a reason for adding this consultee';
		// no consultee found always comes with a name error
		if (!stored || reasonError) {
			return renderAddPage(res, service, context, {
				nameValue,
				reasonValue,
				...(nameError ? { nameError: { text: nameError } } : {}),
				...(reasonError ? { reasonError: { text: reasonError } } : {})
			});
		}

		// one the category page removed comes back as the ruleset found it - its removal undone, not
		// added by hand - so it's drawn and reported as identified again
		const removal = selection.removed.find(
			(removed) => removed.category === category && removed.id?.toLowerCase() === stored.id.toLowerCase()
		);
		const next = removal
			? { removed: selection.removed.filter((removed) => removed !== removal), adds: selection.adds }
			: {
					removed: selection.removed,
					adds: [...selection.adds, { id: stored.id, category, name: stored.consultee, reason }]
				};
		return res.redirect(`${consulteesUrl(project.id, ruleset.id, category, next)}#consultees`);
	};
}
