import type { ManageService } from '#service';
import { findOtherCases } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import {
	consulteeAreaDetails,
	findConsulteeAreasByName,
	findConsulteeAreasByNameStart
} from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import { isIdentified } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler, AsyncRequestHandlerWithBody } from '@planning-inspectorate/core/util';
import type { Response } from 'express';
import {
	distinguishingDetail,
	labelsWithReferenceData,
	labelVariants,
	nameBeforeLabel
} from '../../../consultee-labels.ts';
import { NEARBY_NSIPS, nearbyNsipName } from '../../../nearby-nsips.ts';
import { firstQueryValue, screenedGeometry } from '../../../run-ruleset.ts';
import { categoryDisplayName } from '../../categories.ts';
import { consulteeName } from '../../report-consultees.ts';
import { addConsulteeSuggestionsUrl, addConsulteeUrl, consulteesUrl, excludedMatchIds } from '../../urls.ts';
import type { CategoryContext } from '../controller.ts';
import { categoryContext, comparableName, kilometresFromSite, nearbyCandidates } from '../controller.ts';
import type { AddConsulteeForm, AddConsulteeViewModel } from './view-model.ts';

const VIEW = 'views/consultees/report/consultees/add/view.njk';

/** A consultee the form can add, as it's suggested and matched: `name` is what it's added as. */
interface NameCandidate {
	id: string;
	name: string;
	/** Every name it answers to - for a case, "Name (REF)" and each part alone. */
	aliases: string[];
	distanceMetres: number;
	/** Its region - shown to tell apart consultees that share a name. */
	region?: string | null;
	/** One the category page removed - adding it back undoes the removal. */
	removed?: boolean;
}

/** A candidate as the page offers it: what it's typed as, and the hint beside it. */
interface LabelledCandidate extends NameCandidate {
	label: string;
	hint: string;
}

/**
 * How each candidate is offered and typed: its name - or, when another candidate, a listed
 * consultee or another in the reference data has its name too, its name and what tells it apart,
 * "Middleton (Lancaster)" (see consultee-labels.ts). The hint gives its distance from the site, and
 * its region.
 */
async function labelCandidates(
	service: ManageService,
	category: string,
	candidates: NameCandidate[],
	listed: string[]
): Promise<LabelledCandidate[]> {
	const { labels, sharing } = await labelsWithReferenceData(
		service.db,
		category,
		category !== NEARBY_NSIPS,
		candidates,
		listed
	);
	return candidates.map((candidate) => {
		// every candidate has one
		const label = labels.get(candidate.id)!;
		const isShared = sharing.has(candidate.id);
		const hint = [
			label.includes(' km from the site') ? undefined : kilometresFromSite(candidate.distanceMetres),
			isShared && candidate.region && !label.includes(candidate.region) ? candidate.region : undefined,
			candidate.removed ? 'removed' : undefined
		]
			.filter(Boolean)
			.join(', ');
		return { ...candidate, label, hint };
	});
}

/** The one item, or undefined for none or several. */
function only<T>(items: T[]): T | undefined {
	return items.length === 1 ? items[0] : undefined;
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

/**
 * The consultees already in the category's list, by id - the "already listed" check compares
 * these, not names, so a second consultee of the same name can be added.
 */
function listedIds({ consultees, category, selection }: CategoryContext): Set<string> {
	const excluded = excludedMatchIds(selection.removed);
	return new Set(
		[
			...consultees
				.filter(
					(match) =>
						match.feature.properties.consulteeCategory === category &&
						isIdentified(match) &&
						!excluded.has(match.feature.id)
				)
				.map((match) => match.feature.id),
			...selection.adds.flatMap((add) => (add.category === category && add.id ? [add.id] : []))
		].map((id) => id.toLowerCase())
	);
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
			return {
				id: match.feature.id,
				name,
				aliases: [name],
				distanceMetres: match.distanceMetres,
				region: match.feature.properties.region,
				removed: true
			};
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
			return {
				id: match.feature.id,
				name,
				aliases: [name],
				distanceMetres: match.distanceMetres,
				region: match.feature.properties.region
			};
		})
	];
}

/**
 * The page, with the form's entered values and errors if a submit failed - and, after a name that
 * several consultees have, every one of them among the suggestions, to choose from.
 */
async function renderAddPage(
	res: Response,
	service: ManageService,
	context: CategoryContext,
	form: AddConsulteeForm = { nameValue: '', reasonValue: '' },
	matching: NameCandidate[] = []
): Promise<void> {
	const { project, ruleset, category, selection } = context;

	// one suggestion per consultee, those sharing a name told apart (labelCandidates). Nearby NSIP
	// candidates cover every other case, so the ones already listed are left out of the suggestions
	// (the nearby list only ever holds unlisted consultees)
	const listed = listedNames(context);
	const hidden = new Set(category === NEARBY_NSIPS ? listed : []);
	const candidates = [...(await nameCandidates(service, context))];
	for (const candidate of matching) {
		if (!candidates.some((other) => other.id === candidate.id)) {
			candidates.push(candidate);
		}
	}
	const suggestions = (
		await labelCandidates(
			service,
			category,
			candidates.filter((candidate) => !hidden.has(comparableName(candidate.name))),
			category === NEARBY_NSIPS ? [] : listed
		)
	).map(({ label, hint }) => ({ name: label, hint }));

	const errorSummary = [
		...(form.nameError ? [{ text: form.nameError.text, href: '#consultee-name' }] : []),
		...(form.reasonError ? [{ text: form.reasonError.text, href: '#consultee-reason' }] : [])
	];
	const viewModel: AddConsulteeViewModel = {
		pageHeading: 'Add a consultee',
		pageCaption: categoryDisplayName(category),
		backLinkUrl: consulteesUrl(project.id, ruleset.id, category, selection),
		formAction: addConsulteeUrl(project.id, ruleset.id, category, selection),
		nearbySuggestions: suggestions,
		// a consultee category's suggestions come from the whole of its reference data as a name is
		// typed (buildReportConsulteeAddSuggestions); Nearby NSIPs' are every other case, all on the page
		...(category === NEARBY_NSIPS
			? {}
			: { suggestionsUrl: addConsulteeSuggestionsUrl(project.id, ruleset.id, category, selection) }),
		nameHint:
			category === NEARBY_NSIPS
				? { text: 'Start typing to choose a national infrastructure project by its name or case reference.' }
				: {
						text: 'Start typing to find a consultee - those near the site come first - or paste in a consultee name'
					},
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

// what's typed before the reference data is searched - a letter or two would match thousands
const MIN_SUGGESTION_QUERY = 3;

/**
 * The add page's suggestions as a name is typed - `?q=` - as JSON, `[{ name, hint }]`: the
 * category's consultees anywhere in the reference data whose names start with it (every Newton,
 * for "Newton"), not already listed, each labelled as the page labels it - so "Newton (South
 * Cambridgeshire)" can be chosen at once, rather than only after submitting "Newton" and being
 * told there's more than one. consultee-autocomplete.js adds them to the page's own suggestions.
 */
export function buildReportConsulteeAddSuggestions(service: ManageService): AsyncRequestHandler {
	return async (req, res) => {
		const context = await categoryContext(service, req, res);
		if (!context) {
			return;
		}
		const typed = firstQueryValue(req.query.q).trim().replace(/\s+/g, ' ');
		if (context.category === NEARBY_NSIPS || typed.length < MIN_SUGGESTION_QUERY) {
			res.json([]);
			return;
		}
		const inList = listedIds(context);
		const removed = excludedMatchIds(context.selection.removed);
		const candidates: NameCandidate[] = (
			await findConsulteeAreasByNameStart(service.db, context.category, typed, screenedGeometry(context.project))
		)
			.filter((area) => !inList.has(area.id))
			.map((area) => ({
				id: area.id,
				name: area.consultee,
				aliases: [area.consultee],
				distanceMetres: area.distanceMetres,
				region: area.region,
				removed: removed.has(area.id)
			}));
		const labelled = await labelCandidates(service, context.category, candidates, listedNames(context));
		res.json(labelled.map(({ label, hint }) => ({ name: label, hint })));
	};
}

/**
 * The consultees of the category called `name`, not already listed: those the page suggested -
 * near the site, or removed from the list - and then the rest of the reference data's.
 */
async function consulteesNamed(
	service: ManageService,
	context: CategoryContext,
	name: string
): Promise<{ suggested: NameCandidate[]; matching: NameCandidate[] }> {
	const inList = listedIds(context);
	const removed = excludedMatchIds(context.selection.removed);
	const suggested = (await nameCandidates(service, context)).filter(
		(candidate) => comparableName(candidate.name) === comparableName(name)
	);
	const matching: NameCandidate[] = [...suggested];
	const named = await findConsulteeAreasByName(service.db, context.category, name, screenedGeometry(context.project));
	for (const area of named) {
		if (!inList.has(area.id) && !matching.some((candidate) => candidate.id === area.id)) {
			matching.push({
				id: area.id,
				name: area.consultee,
				aliases: [area.consultee],
				distanceMetres: area.distanceMetres,
				region: area.region,
				removed: removed.has(area.id)
			});
		}
	}
	return { suggested, matching };
}

/** What a typed name came to: the consultee it is, or why not - with the consultees it could be. */
interface ResolvedName {
	stored?: { id: string; consultee: string };
	error?: string;
	/** Every consultee of the name, for the page to suggest when it's more than one. */
	matching: NameCandidate[];
}

/**
 * The consultee a typed name is. For Nearby NSIPs, the other case it names. For a consultee
 * category, any consultee of the category in the reference data, near the site or not: a name only
 * one unlisted consultee has is that one; one several have - Middleton - has to be told apart by
 * the label the page suggests it with, "Middleton (Lancaster)". A consultee already in
 * the list - the same one, by id - is refused, but another of its name can be added.
 */
async function resolveTypedName(
	service: ManageService,
	context: CategoryContext,
	typed: string
): Promise<ResolvedName> {
	const { category } = context;
	const categoryName = categoryDisplayName(category);
	const listed = listedNames(context);
	if (category === NEARBY_NSIPS) {
		// case names carry their reference, so a name is one case
		const candidate = (await nameCandidates(service, context)).find((other) =>
			other.aliases.some((alias) => comparableName(alias) === comparableName(typed))
		);
		const listedAs = listed.includes(comparableName(typed))
			? typed
			: candidate && listed.includes(comparableName(candidate.name))
				? candidate.name
				: undefined;
		if (listedAs) {
			return { error: `${listedAs} is already listed in ${categoryName}`, matching: [] };
		}
		return candidate
			? { stored: { id: candidate.id, consultee: candidate.name }, matching: [] }
			: { error: 'Consultee not found', matching: [] };
	}

	// the name as typed - or, when no consultee is called that, a label the page gave: the name
	// before its last bracket, "Middleton (Lancaster)". Names can have brackets of their own -
	// "Aikengall II (Scotland)" - so the name as typed comes first
	let name = typed;
	let { suggested, matching } = await consulteesNamed(service, context, name);
	const labelName = nameBeforeLabel(typed);
	const asLabel = matching.length === 0 && labelName !== undefined && !listed.includes(comparableName(typed));
	if (asLabel) {
		name = labelName;
		({ suggested, matching } = await consulteesNamed(service, context, name));
	}
	const nameListed = listed.includes(comparableName(name));
	// one added by name alone, from a link made before additions kept their id, can't be told from
	// another of its name - so its name is refused outright, as before
	const addedByNameAlone = context.selection.adds.some(
		(add) => add.category === category && !add.id && comparableName(add.name) === comparableName(name)
	);
	if (addedByNameAlone) {
		return { error: `${name} is already listed in ${categoryName}`, matching: [] };
	}
	let picked: NameCandidate | undefined;
	if (asLabel) {
		// the one of the name the label is, in any of the ways the page gives it
		const details = await consulteeAreaDetails(
			service.db,
			matching.map(({ id }) => id)
		);
		picked = only(
			matching.filter((candidate) =>
				labelVariants(candidate, distinguishingDetail(category, details.get(candidate.id.toLowerCase()))).some(
					(variant) => comparableName(variant) === comparableName(typed)
				)
			)
		);
	} else if (!nameListed) {
		// a name alone: the one the page suggested, or else the only one there is - never when one of
		// the name is already listed, as which was meant can't be told
		picked = suggested.length > 0 ? only(suggested) : only(matching);
	}
	if (picked) {
		return { stored: { id: picked.id, consultee: picked.name }, matching: [] };
	}
	if (matching.length === 0) {
		return { error: nameListed ? `${name} is already listed in ${categoryName}` : 'Consultee not found', matching: [] };
	}
	const spelt = matching[0].name;
	return {
		error: nameListed
			? `${spelt} is already listed in ${categoryName} - to add another ${spelt}, choose it from the list`
			: `There is more than one ${spelt} - choose the one you mean from the list`,
		matching
	};
}

/**
 * Saves a hand-added consultee. The name and the reason are both required - like the removal
 * reason, the reason is recorded for auditing and shows in the Identified column. The name has to
 * be a real consultee of the category, case and spacing aside (resolveTypedName), so the report has
 * its stored row - for a consultee category, a nearby one or any other in the reference data, one
 * of a name several share chosen by its label; for Nearby NSIPs, another case's newest shapefile.
 * Anything else - a typo, or a made-up name - is refused, as is a consultee already listed. A failed submit shows the page again with the entered values and an error per field; a
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

		const resolved = name
			? await resolveTypedName(service, context, name)
			: { error: 'Enter the consultee name', matching: [] };
		const reasonError = reason ? undefined : 'Enter a reason for adding this consultee';
		// no consultee found always comes with a name error
		if (!resolved.stored || reasonError) {
			return renderAddPage(
				res,
				service,
				context,
				{
					nameValue,
					reasonValue,
					...(resolved.error ? { nameError: { text: resolved.error } } : {}),
					...(reasonError ? { reasonError: { text: reasonError } } : {})
				},
				resolved.matching
			);
		}
		const { stored } = resolved;

		// one the category page removed comes back as the ruleset found it - its removal undone, not
		// added by hand - so it's drawn and reported as identified again
		const removal = selection.removed.find(
			(removed) => removed.category === category && removed.id?.toLowerCase() === stored.id.toLowerCase()
		);
		const next = removal
			? { ...selection, removed: selection.removed.filter((removed) => removed !== removal) }
			: { ...selection, adds: [...selection.adds, { id: stored.id, category, name: stored.consultee, reason }] };
		return res.redirect(`${consulteesUrl(project.id, ruleset.id, category, next)}#consultees`);
	};
}
