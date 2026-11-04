import type { ManageService } from '#service';
import { findOtherCases } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import { findConsulteeAreasByName } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
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
 * How each candidate is offered and typed. Several consultees can share a name - 575 parish names
 * are shared, 12 parishes are called Middleton - so one whose name another candidate or a listed
 * consultee also has reads with its distance from the site, "Middleton (3.2 km from the site)", and
 * its region as the hint: each can be told apart, and picked. Two that would still read the same add
 * their region.
 */
function labelCandidates(candidates: NameCandidate[], listed: string[]): LabelledCandidate[] {
	const names = [...candidates.map((candidate) => comparableName(candidate.name)), ...listed];
	const shared = new Set(names.filter((name, index) => names.indexOf(name) !== index));
	const labelled = candidates.map((candidate) => {
		const isShared = shared.has(comparableName(candidate.name));
		const distance = kilometresFromSite(candidate.distanceMetres);
		const hint = [isShared ? candidate.region : distance, candidate.removed ? 'removed' : undefined]
			.filter(Boolean)
			.join(', ');
		return { ...candidate, label: isShared ? `${candidate.name} (${distance})` : candidate.name, hint };
	});
	const labels = labelled.map(({ label }) => comparableName(label));
	return labelled.map((candidate) =>
		labels.filter((label) => label === comparableName(candidate.label)).length > 1
			? {
					...candidate,
					label: `${candidate.name} (${kilometresFromSite(candidate.distanceMetres)}, ${candidate.region ?? candidate.id})`
				}
			: candidate
	);
}

const LABEL = /^(.*) \(([\d.]+ km from the site)(?:, ([^)]*))?\)$/i;

/**
 * A typed name, and - for a label labelCandidates gave - the distance (and region or id) that tells
 * it from others of the name: "Middleton (3.2 km from the site)".
 */
function parseLabel(typed: string): { name: string; distance?: string; detail?: string } {
	const match = LABEL.exec(typed);
	return match
		? { name: match[1], distance: match[2].toLowerCase(), ...(match[3] ? { detail: match[3] } : {}) }
		: { name: typed };
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
	const suggestions = labelCandidates(
		candidates.filter((candidate) => !hidden.has(comparableName(candidate.name))),
		category === NEARBY_NSIPS ? [] : listed
	).map(({ label, hint }) => ({ name: label, hint }));

	const errorSummary = [
		...(form.nameError ? [{ text: form.nameError.text, href: '#consultee-name' }] : []),
		...(form.reasonError ? [{ text: form.reasonError.text, href: '#consultee-reason' }] : [])
	];
	const viewModel: AddConsulteeViewModel = {
		pageHeading: 'Add a consultee',
		pageCaption: category,
		backLinkUrl: consulteesUrl(project.id, ruleset.id, category, selection),
		formAction: addConsulteeUrl(project.id, ruleset.id, category, selection),
		nearbySuggestions: suggestions,
		nameHint:
			category === NEARBY_NSIPS
				? { text: 'Start typing to choose a national infrastructure project by its name or case reference.' }
				: suggestions.length
					? {
							text: 'Start typing to find consultees local to the site or directly copy and paste in a consultee name'
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
 * the label the page suggests it with, "Middleton (3.2 km from the site)". A consultee already in
 * the list - the same one, by id - is refused, but another of its name can be added.
 */
async function resolveTypedName(
	service: ManageService,
	context: CategoryContext,
	typed: string
): Promise<ResolvedName> {
	const { project, category } = context;
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
			return { error: `${listedAs} is already listed in ${category}`, matching: [] };
		}
		return candidate
			? { stored: { id: candidate.id, consultee: candidate.name }, matching: [] }
			: { error: 'Consultee not found', matching: [] };
	}

	const { name, distance, detail } = parseLabel(typed);
	const inList = listedIds(context);
	const nameListed = listed.includes(comparableName(name));
	// one added by name alone, from a link made before additions kept their id, can't be told from
	// another of its name - so its name is refused outright, as before
	const addedByNameAlone = context.selection.adds.some(
		(add) => add.category === category && !add.id && comparableName(add.name) === comparableName(name)
	);
	if (addedByNameAlone) {
		return { error: `${name} is already listed in ${category}`, matching: [] };
	}
	const named = (candidate: NameCandidate) => comparableName(candidate.name) === comparableName(name);
	// the ones the page suggested - near the site, or removed from the list - then the rest of the
	// reference data's consultees of the name
	const suggested = (await nameCandidates(service, context)).filter(named);
	const removed = excludedMatchIds(context.selection.removed);
	const matching: NameCandidate[] = [...suggested];
	for (const area of await findConsulteeAreasByName(service.db, category, name, project.geometry)) {
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
	const picked = distance
		? // a suggestion's label: the one of the name at that distance (and region, if it says)
			only(
				matching.filter(
					(candidate) =>
						kilometresFromSite(candidate.distanceMetres) === distance &&
						(!detail || candidate.region === detail || candidate.id === detail)
				)
			)
		: // a name alone: the one the page suggested, or else the only one there is - never when one of
			// the name is already listed, as which was meant can't be told
			nameListed
			? undefined
			: suggested.length > 0
				? only(suggested)
				: only(matching);
	if (picked) {
		return { stored: { id: picked.id, consultee: picked.name }, matching: [] };
	}
	if (matching.length === 0) {
		return { error: nameListed ? `${name} is already listed in ${category}` : 'Consultee not found', matching: [] };
	}
	const spelt = matching[0].name;
	return {
		error: nameListed
			? `${spelt} is already listed in ${category} - to add another ${spelt}, choose it from the list`
			: `There is more than one ${spelt} - choose the one you mean from the list`,
		matching
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
