import type { ManageService } from '#service';
import type { CaseBoundarySummary } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import { listConsulteeCategories } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import type { Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { getRuleset, RULESETS } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler, AsyncRequestHandlerWithBody } from '@planning-inspectorate/core/util';
import type { Response } from 'express';
import { resolveCaseSummary } from '../../../resolve-case.ts';
import { firstQueryValue } from '../../../run-ruleset.ts';
import { rulesetCategories } from '../../categories.ts';
import type { ConsulteeSelection } from '../../urls.ts';
import { addConsulteeUrl, addedConsultees, consulteesUrl, excludedIds } from '../../urls.ts';
import type { AddConsulteeViewModel } from './view-model.ts';

interface AddConsulteeContext {
	project: CaseBoundarySummary;
	ruleset: Ruleset;
	category: string;
	selection: ConsulteeSelection;
}

/**
 * The case/ruleset/category a "Select a consultee" request targets, since this form lives under a
 * category page: a case that isn't found, a ruleset that isn't known, or a category that's neither
 * one the ruleset covers nor one in the reference data (the nearby search finds those) 404s. `undefined` means a response has
 * already been sent.
 */
async function addConsulteeContext(
	service: ManageService,
	caseId: string,
	query: Record<string, unknown>,
	res: Response
): Promise<AddConsulteeContext | undefined> {
	const project = await resolveCaseSummary(service.db, caseId);
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
	return {
		project,
		ruleset,
		category,
		selection: {
			excluded: excludedIds(query.exclude),
			adds: addedConsultees(query.add)
		}
	};
}

function viewModel(
	{ project, ruleset, category, selection }: AddConsulteeContext,
	nameValue = '',
	reasonValue = '',
	nameError?: string
): AddConsulteeViewModel {
	return {
		pageHeading: 'Select a consultee',
		pageCaption: category,
		backLinkUrl: consulteesUrl(project.id, ruleset.id, category, selection),
		formAction: addConsulteeUrl(project.id, ruleset.id, category, selection),
		nameValue,
		reasonValue,
		...(nameError
			? {
					nameError: { text: nameError },
					errorSummary: [{ text: nameError, href: '#consultee-name' }]
				}
			: {})
	};
}

/**
 * The "Select a consultee" form a category page's "Add consultee" button opens: a name input
 * and a reason textarea. Saving adds the consultee to the URL's `add` params and returns to the
 * category page where it's listed below the map.
 */
export function buildReportConsulteeAddPage(service: ManageService): AsyncRequestHandler {
	return async (req, res) => {
		const context = await addConsulteeContext(service, String(req.params.caseId ?? ''), req.query, res);
		if (!context) {
			return;
		}
		return res.render('views/consultees/report/consultees/add/view.njk', viewModel(context));
	};
}

/**
 * Saves a hand-added consultee. The name is required (it's the row's only required value) - a
 * blank submit re-renders the form with the entered values and a validation error; the reason
 * is optional free text shown in the category page's Identified column. On success the new
 * consultee joins the `add` params and the user lands back on the category page.
 */
export function buildReportConsulteeAddSubmit(
	service: ManageService
): AsyncRequestHandlerWithBody<{ name?: unknown; reason?: unknown }> {
	return async (req, res) => {
		const context = await addConsulteeContext(service, String(req.params.caseId ?? ''), req.query, res);
		if (!context) {
			return;
		}
		const { project, ruleset, category, selection } = context;

		const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
		const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
		if (!name) {
			return res.render(
				'views/consultees/report/consultees/add/view.njk',
				viewModel(context, typeof req.body?.name === 'string' ? req.body.name : '', reason, 'Enter the consultee name')
			);
		}

		const adds = [...selection.adds, { category, name, reason }];
		return res.redirect(consulteesUrl(project.id, ruleset.id, category, { excluded: selection.excluded, adds }));
	};
}
