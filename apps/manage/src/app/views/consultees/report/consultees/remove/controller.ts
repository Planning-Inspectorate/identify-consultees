import type { ManageService } from '#service';
import type { Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { isIdentified } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler, AsyncRequestHandlerWithBody } from '@planning-inspectorate/core/util';
import type { Response } from 'express';
import { describeReasons } from '../../../reasons.ts';
import { resolveCase, resolveCaseSummary } from '../../../resolve-case.ts';
import type { RulesetRunStore } from '../../../run-ruleset.ts';
import { firstQueryValue, requestedRuleset, runRulesetSafely } from '../../../run-ruleset.ts';
import { categoryDisplayName } from '../../categories.ts';
import { addedConsulteeReason, consulteeName } from '../../report-consultees.ts';
import type { ConsulteeSelection, RemovalTarget } from '../../urls.ts';
import { consulteeSelection, consulteesUrl, excludedMatchIds, queryValues, removeConsulteeUrl } from '../../urls.ts';
import type { RemoveConsulteeViewModel } from './view-model.ts';

/** One consultee being removed: what to drop/exclude, and its name and why it was identified. */
interface ResolvedRemovalTarget {
	target: RemovalTarget;
	name: string;
	identified: string[];
}

interface RemoveConsulteeContext {
	caseId: string;
	ruleset: Ruleset;
	/** The category it's being removed from - the page caption, as the Add a consultee page's. */
	category: string;
	selection: ConsulteeSelection;
	/** The consultees being removed - one row of the summary table each, in param order. */
	targets: ResolvedRemovalTarget[];
	/** A match target whose ruleset run failed can't be resolved - the page shows an error, not the form. */
	rulesetFailed: boolean;
}

/**
 * The case/ruleset/category and consultees a "Remove consultee" request targets: each `?match=`
 * is a ruleset match's feature id (resolved by running the ruleset - every one must be in this
 * category and not already removed) and each `?added=` an index into the `add` params. A bulk
 * removal from the category page's checkboxes arrives the same way, just with the params
 * repeated - or, when that page's Select all box submits it (which only happens without JS, as
 * consultee-select.js strips its name), a `?select-all=` that means every listed consultee.
 * Anything else - a case or ruleset that isn't found, no targets, or one that doesn't
 * resolve - 404s. `undefined` means a response has already been sent.
 */
async function removeConsulteeContext(
	service: ManageService,
	caseId: string,
	query: Record<string, unknown>,
	res: Response,
	store?: RulesetRunStore
): Promise<RemoveConsulteeContext | undefined> {
	const ruleset = requestedRuleset(query.ruleset);
	if (!ruleset) {
		res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
		return undefined;
	}
	const category = firstQueryValue(query.category);
	const selection = consulteeSelection(query);
	const matchIds = queryValues(query.match);
	const addedValues = queryValues(query.added);
	const selectAll = queryValues(query['select-all']).length > 0;
	if (!selectAll && matchIds.length === 0 && addedValues.length === 0) {
		res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
		return undefined;
	}

	const targets: ResolvedRemovalTarget[] = [];
	let resolvedCaseId = caseId;

	if (matchIds.length > 0 || selectAll) {
		const project = await resolveCase(service.db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return undefined;
		}
		resolvedCaseId = project.id;
		const { consultees, failed } = await runRulesetSafely(service, project, ruleset, store);
		if (failed) {
			return {
				caseId: project.id,
				ruleset,
				category,
				selection,
				targets: [],
				rulesetFailed: true
			};
		}
		const excluded = excludedMatchIds(selection.removed);
		// select-all wants every match the category page listed: identified by a condition
		// (nearby-only consultees aren't in the report), in this category, not already removed
		const wantedMatchIds = selectAll
			? consultees
					.filter(
						(match) =>
							isIdentified(match) &&
							match.feature.properties.consulteeCategory === category &&
							!excluded.has(match.feature.id)
					)
					.map((match) => match.feature.id)
			: matchIds;
		for (const matchId of wantedMatchIds) {
			const match = consultees.find((consultee) => consultee.feature.id === matchId);
			// a stale or crafted link - every match has to be listed in this category: identified
			// by a condition (nearby-only consultees aren't in the report) and not already removed
			if (
				!match ||
				!isIdentified(match) ||
				match.feature.properties.consulteeCategory !== category ||
				excluded.has(matchId)
			) {
				res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
				return undefined;
			}
			targets.push({
				target: { matchId },
				name: consulteeName(match),
				identified: describeReasons(match, ruleset, { nearby: false })
			});
		}
	}

	if (addedValues.length > 0 || selectAll) {
		// the match path's resolved project answers this too - the summary lookup only runs when
		// the removal is hand-added consultees alone (which also skips the ruleset run)
		const project =
			matchIds.length > 0 || selectAll ? { id: resolvedCaseId } : await resolveCaseSummary(service.db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return undefined;
		}
		resolvedCaseId = project.id;
		// select-all wants every add the category page listed - the ones in this category only
		const wantedAddedValues = selectAll
			? selection.adds.flatMap((add, index) => (add.category === category ? [String(index)] : []))
			: addedValues;
		for (const value of wantedAddedValues) {
			// Number('') is 0 - a missing param must not read as index 0 (queryValues drops blanks)
			const addedIndex = Number(value);
			const add = Number.isInteger(addedIndex) ? selection.adds[addedIndex] : undefined;
			if (!add || add.category !== category) {
				res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
				return undefined;
			}
			targets.push({
				target: { addedIndex },
				name: add.name,
				identified: [addedConsulteeReason(add)]
			});
		}
	}

	// select-all's enumeration filters rather than 404ing, so an empty category arrives here -
	// a page that never rendered the form has nothing to remove
	if (targets.length === 0) {
		res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
		return undefined;
	}
	return {
		caseId: resolvedCaseId,
		ruleset,
		category,
		selection,
		targets,
		rulesetFailed: false
	};
}

function viewModel(context: RemoveConsulteeContext, reasonValue = '', reasonError?: string): RemoveConsulteeViewModel {
	const selfUrl = removeConsulteeUrl(
		context.caseId,
		context.ruleset.id,
		context.category,
		context.targets.map(({ target }) => target),
		context.selection
	);
	return {
		pageHeading: 'Remove consultee',
		pageCaption: categoryDisplayName(context.category),
		backLinkUrl: consulteesUrl(context.caseId, context.ruleset.id, context.category, context.selection),
		formAction: selfUrl,
		consultees: context.targets.map(({ name, identified }) => ({ name, identified })),
		reasonValue,
		...(reasonError
			? {
					reasonError: { text: reasonError },
					errorSummary: [{ text: reasonError, href: '#removal-reason' }]
				}
			: {}),
		rulesetFailed: context.rulesetFailed,
		retryUrl: selfUrl
	};
}

/**
 * The "Remove consultee" form a category page row's Remove link opens: the consultee's name and
 * why it was identified, then a reason textarea. Submitting records the removal - and its
 * reason - in the URL's `exclude` params and returns to the category page, which lists it in
 * the expandable Removed consultees section.
 */
export function buildReportConsulteeRemovePage(service: ManageService): AsyncRequestHandler {
	return async (req, res) => {
		const context = await removeConsulteeContext(service, String(req.params.caseId ?? ''), req.query, res, req.session);
		if (!context) {
			return;
		}
		return res.render('views/consultees/report/consultees/remove/view.njk', viewModel(context));
	};
}

/**
 * Saves a removal. The reason is required - it's the whole point of the page - so a blank
 * submit re-renders the form with the entered value and a validation error. On success a
 * match's exclusion or a hand-added consultee's dropped `add` param joins the selection as a
 * recorded removal and the user lands back on the category page with its Removed consultees
 * section open.
 */
export function buildReportConsulteeRemoveSubmit(
	service: ManageService
): AsyncRequestHandlerWithBody<{ reason?: unknown }> {
	return async (req, res) => {
		const context = await removeConsulteeContext(service, String(req.params.caseId ?? ''), req.query, res, req.session);
		if (!context) {
			return;
		}
		if (context.rulesetFailed) {
			return res.render('views/consultees/report/consultees/remove/view.njk', viewModel(context));
		}
		const { caseId, ruleset, category, selection } = context;

		const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
		if (!reason) {
			return res.render(
				'views/consultees/report/consultees/remove/view.njk',
				viewModel(
					context,
					typeof req.body?.reason === 'string' ? req.body.reason : '',
					context.targets.length > 1
						? 'Enter a reason for removing these consultees'
						: 'Enter a reason for removing this consultee'
				)
			);
		}

		// one reason serves the whole submission - every target joins the selection as a recorded
		// removal, and each hand-added consultee's `add` param is dropped alongside it
		const removed = [
			...selection.removed,
			...context.targets.map(({ target, name }) => ({
				...('matchId' in target ? { id: target.matchId } : {}),
				category,
				name,
				reason
			}))
		];
		const droppedAdds = new Set(
			context.targets.flatMap(({ target }) => ('addedIndex' in target ? [target.addedIndex] : []))
		);
		const adds = selection.adds.filter((_, index) => !droppedAdds.has(index));
		return res.redirect(`${consulteesUrl(caseId, ruleset.id, category, { ...selection, removed, adds })}&removed=open`);
	};
}
