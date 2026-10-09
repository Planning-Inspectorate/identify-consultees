import type { ManageService } from '#service';
import { getRuleset, RULESETS } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler, AsyncRequestHandlerWithBody } from '@planning-inspectorate/core/util';
import type { ConsulteeSelection } from '../report/urls.ts';
import { addedConsultees, excludedIds, reportUrl, rulesetUrl } from '../report/urls.ts';
import { isCaseId, resolveCaseSummary } from '../resolve-case.ts';
import { firstQueryValue, selectedRuleset } from '../run-ruleset.ts';
import type { RulesetPickerViewModel } from './view-model.ts';

/**
 * Step 3 of the identify-consultees flow: pick the ruleset the report is generated with, after
 * the boundary page's "Continue". Radio buttons for every ruleset, the current one (or the top
 * option, when none is selected) pre-checked. "Identify consultees" posts back here and leads to
 * the check page, which runs the ruleset - nothing is stored server-side, the choice lives in
 * the report page URL it redirects to.
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

		const ruleset = selectedRuleset(req.query?.ruleset);
		// the check page's "Change" link arrives here carrying the user's consultee selection -
		// the form posts back to the same URL so the submit can carry it on to the report
		const selection: ConsulteeSelection = {
			excluded: excludedIds(req.query?.exclude),
			adds: addedConsultees(req.query?.add)
		};

		const viewModel: RulesetPickerViewModel = {
			pageHeading: 'Ruleset',
			pageCaption: project.caseName,
			backLinkUrl: `/consultees/${encodeURIComponent(project.id)}`,
			caseId: project.id,
			formAction: rulesetUrl(project.id, ruleset.id, selection),
			rulesets: RULESETS.map((option) => ({ value: option.id, text: option.name, checked: option.id === ruleset.id }))
		};

		return res.render('views/consultees/ruleset/view.njk', viewModel);
	};
}

/**
 * "Identify consultees" on the ruleset picker: store nothing server-side - the choice lives in
 * the check page URL it redirects to. An unrecognised value just returns to the picker
 * unchanged. Any consultee selection the check page's "Change" link sent rides along in both.
 */
export function buildRulesetPickerSubmit(): AsyncRequestHandlerWithBody<{ ruleset?: unknown }> {
	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		if (!isCaseId(caseId)) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		const selection: ConsulteeSelection = {
			excluded: excludedIds(req.query?.exclude),
			adds: addedConsultees(req.query?.add)
		};
		const ruleset = getRuleset(firstQueryValue(req.body?.ruleset));
		if (!ruleset) {
			res.redirect(rulesetUrl(caseId, RULESETS[0].id, selection));
			return;
		}

		res.redirect(reportUrl(caseId, ruleset.id, selection));
	};
}
