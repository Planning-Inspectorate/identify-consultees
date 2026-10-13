import type { ManageService } from '#service';
import type { Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import {
	getRuleset,
	isIdentifiedByCondition,
	RULESETS
} from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler, AsyncRequestHandlerWithBody } from '@planning-inspectorate/core/util';
import type { Response } from 'express';
import { describeReasons } from '../../../reasons.ts';
import { resolveCase, resolveCaseSummary } from '../../../resolve-case.ts';
import type { RulesetRunStore } from '../../../run-ruleset.ts';
import { firstQueryValue, runRulesetSafely } from '../../../run-ruleset.ts';
import { addedConsulteeReason, consulteeName } from '../../report-consultees.ts';
import type { ConsulteeSelection, RemovalTarget } from '../../urls.ts';
import { consulteeSelection, consulteesUrl, excludedMatchIds, removeConsulteeUrl } from '../../urls.ts';
import type { RemoveConsulteeViewModel } from './view-model.ts';

interface RemoveConsulteeContext {
	caseId: string;
	/** The case name - the page caption. */
	caseName: string;
	ruleset: Ruleset;
	category: string;
	selection: ConsulteeSelection;
	/** Which consultee the page is removing - a ruleset match or a hand-added one. */
	target: RemovalTarget;
	/** The consultee's name and why it was identified - the page's summary table, and what the recorded removal keeps. */
	name: string;
	identified: string[];
	/** A match target whose ruleset run failed can't be resolved - the page shows an error, not the form. */
	rulesetFailed: boolean;
}

/**
 * The case/ruleset/category and consultee a "Remove consultee" request targets: `?match=` is a
 * ruleset match's feature id (resolved by running the ruleset - it must be in this category and
 * not already removed) and `?added=` is an index into the `add` params. Anything else - a case
 * or ruleset that isn't found, a missing or unresolvable target - 404s. `undefined` means a
 * response has already been sent.
 */
async function removeConsulteeContext(
	service: ManageService,
	caseId: string,
	query: Record<string, unknown>,
	res: Response,
	store?: RulesetRunStore
): Promise<RemoveConsulteeContext | undefined> {
	const requestedRuleset = firstQueryValue(query.ruleset);
	const ruleset = requestedRuleset ? getRuleset(requestedRuleset) : RULESETS[0];
	if (!ruleset) {
		res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
		return undefined;
	}
	const category = firstQueryValue(query.category);
	const selection = consulteeSelection(query);
	const matchId = firstQueryValue(query.match);

	if (matchId) {
		const project = await resolveCase(service.db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return undefined;
		}
		const { consultees, failed } = await runRulesetSafely(
			service.rulesetRunner,
			project,
			ruleset,
			service.nearbyConsulteeRadiusMetres,
			service.logger,
			store
		);
		if (failed) {
			return {
				caseId: project.id,
				caseName: project.properties.caseName,
				ruleset,
				category,
				selection,
				target: { matchId },
				name: '',
				identified: [],
				rulesetFailed: true
			};
		}
		const match = consultees.find((consultee) => consultee.feature.id === matchId);
		// a stale or crafted link - the match has to be listed in this category: identified by a
		// condition (nearby-only consultees aren't in the report) and not already removed
		if (
			!match ||
			!isIdentifiedByCondition(match) ||
			match.feature.properties.consulteeCategory !== category ||
			excludedMatchIds(selection.removed).has(matchId)
		) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return undefined;
		}
		return {
			caseId: project.id,
			caseName: project.properties.caseName,
			ruleset,
			category,
			selection,
			target: { matchId },
			name: consulteeName(match),
			identified: describeReasons(match, ruleset, { nearby: false }),
			rulesetFailed: false
		};
	}

	const addedParam = firstQueryValue(query.added);
	// Number('') is 0 - a missing param must not read as index 0
	const addedIndex = addedParam === '' ? Number.NaN : Number(addedParam);
	const add = Number.isInteger(addedIndex) ? selection.adds[addedIndex] : undefined;
	if (!add || add.category !== category) {
		res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
		return undefined;
	}
	const project = await resolveCaseSummary(service.db, caseId);
	if (!project) {
		res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
		return undefined;
	}
	return {
		caseId: project.id,
		caseName: project.caseName,
		ruleset,
		category,
		selection,
		target: { addedIndex },
		name: add.name,
		identified: [addedConsulteeReason(add)],
		rulesetFailed: false
	};
}

function viewModel(context: RemoveConsulteeContext, reasonValue = '', reasonError?: string): RemoveConsulteeViewModel {
	const selfUrl = removeConsulteeUrl(
		context.caseId,
		context.ruleset.id,
		context.category,
		context.target,
		context.selection
	);
	return {
		pageHeading: 'Remove consultee',
		pageCaption: context.caseName,
		backLinkUrl: consulteesUrl(context.caseId, context.ruleset.id, context.category, context.selection),
		formAction: selfUrl,
		name: context.name,
		identified: context.identified,
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
		const { caseId, ruleset, category, selection, target } = context;

		const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
		if (!reason) {
			return res.render(
				'views/consultees/report/consultees/remove/view.njk',
				viewModel(
					context,
					typeof req.body?.reason === 'string' ? req.body.reason : '',
					'Enter a reason for removing this consultee.'
				)
			);
		}

		const removed = [
			...selection.removed,
			{ ...('matchId' in target ? { id: target.matchId } : {}), category, name: context.name, reason }
		];
		const adds =
			'addedIndex' in target ? selection.adds.filter((_, index) => index !== target.addedIndex) : selection.adds;
		return res.redirect(`${consulteesUrl(caseId, ruleset.id, category, { removed, adds })}&removed=open`);
	};
}
