import type { ManageService } from '#service';
import type { CaseBoundarySummary } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import { getRuleset, RULESETS } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler, AsyncRequestHandlerWithBody } from '@planning-inspectorate/core/util';
import type { ConsulteeSelection } from '../report/urls.ts';
import { consulteeSelection, reportUrl, rulesetUrl } from '../report/urls.ts';
import { isCaseId, resolveCaseSummary } from '../resolve-case.ts';
import { firstQueryValue } from '../run-ruleset.ts';
import type { RulesetPickerViewModel } from './view-model.ts';

/**
 * The picker's view model: a radio per ruleset, checked only when it is the user's existing
 * answer (the check page's "Change"/back links carry it in `?ruleset=`). The Design System's
 * radios guidance says never to pre-select an option the user hasn't chosen, so a first visit -
 * or an unrecognised `?ruleset=` - checks nothing, and `rulesetError` marks the radios invalid
 * after an unanswered submit.
 */
function pickerViewModel(
	project: CaseBoundarySummary,
	requestedRulesetId: string,
	selection: ConsulteeSelection,
	rulesetError?: string
): RulesetPickerViewModel {
	const requestedRuleset = getRuleset(requestedRulesetId);
	return {
		pageHeading: 'Ruleset',
		pageCaption: project.caseName,
		backLinkUrl: `/consultees/${encodeURIComponent(project.id)}`,
		caseId: project.id,
		formAction: rulesetUrl(project.id, requestedRuleset?.id, selection),
		rulesets: RULESETS.map((option) => ({
			value: option.id,
			text: option.name,
			checked: option.id === requestedRuleset?.id
		})),
		...(rulesetError
			? { rulesetError: { text: rulesetError }, errorSummary: [{ text: rulesetError, href: '#ruleset' }] }
			: {})
	};
}

/**
 * Step 3 of the identify-consultees flow: pick the ruleset the report is generated with, after
 * the boundary page's "Continue". "Identify consultees" posts back here and leads to the check
 * page, which runs the ruleset - nothing is stored server-side, the choice lives in the report
 * page URL it redirects to.
 */
export function buildRulesetPickerPage(service: ManageService): AsyncRequestHandler {
	const { db } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		// this page never touches the project's geometry - only the boundary and report pages do -
		// so it looks up the lighter summary rather than fetching/parsing a boundary shape
		const project = await resolveCaseSummary(db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		// the check page's "Change" link arrives here carrying the user's consultee selection -
		// the form posts back to the same URL so the submit can carry it on to the report
		const selection: ConsulteeSelection = consulteeSelection(req.query);

		return res.render(
			'views/consultees/ruleset/view.njk',
			pickerViewModel(project, firstQueryValue(req.query?.ruleset), selection)
		);
	};
}

/**
 * "Identify consultees" on the ruleset picker: store nothing server-side - the choice lives in
 * the check page URL it redirects to. Nothing is checked until the user picks, so an unanswered
 * (or unrecognised) submit re-renders the picker with a validation error rather than guessing.
 * Any consultee selection the check page's "Change" link sent rides along in both.
 */
export function buildRulesetPickerSubmit(service: ManageService): AsyncRequestHandlerWithBody<{ ruleset?: unknown }> {
	const { db } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		if (!isCaseId(caseId)) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}
		const project = await resolveCaseSummary(db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		const selection: ConsulteeSelection = consulteeSelection(req.query);
		const chosen = firstQueryValue(req.body?.ruleset);
		const ruleset = getRuleset(chosen);
		if (!ruleset) {
			res.render('views/consultees/ruleset/view.njk', pickerViewModel(project, chosen, selection, 'Select a ruleset'));
			return;
		}

		res.redirect(reportUrl(caseId, ruleset.id, selection));
	};
}
