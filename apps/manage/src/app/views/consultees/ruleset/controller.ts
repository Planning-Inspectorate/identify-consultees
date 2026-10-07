import type { ManageService } from '#service';
import { getRuleset, RULESETS } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler, AsyncRequestHandlerWithBody } from '@planning-inspectorate/core/util';
import { isCaseId, resolveCaseSummary } from '../resolve-case.ts';
import { firstQueryValue, projectPageUrl, selectedRuleset } from '../run-ruleset.ts';
import type { RulesetPickerViewModel } from './view-model.ts';

function pickerUrl(caseId: string, rulesetId: string): string {
	return `/consultees/${encodeURIComponent(caseId)}/ruleset?ruleset=${encodeURIComponent(rulesetId)}`;
}

/**
 * The map page's "Change ruleset" page: radio buttons for every ruleset, the current one (or the
 * top option, when none is selected) pre-checked. "Save and return" posts back here and redirects
 * to the map page, which re-runs and re-renders with the new ruleset.
 */
export function buildRulesetPickerPage(service: ManageService): AsyncRequestHandler {
	const { db } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		// this page never touches the project's geometry - only the map and results pages do - so it
		// looks up the lighter summary rather than fetching/parsing a boundary shape
		const project = await resolveCaseSummary(db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		const ruleset = selectedRuleset(req.query.ruleset);

		const viewModel: RulesetPickerViewModel = {
			pageHeading: 'Ruleset',
			backLinkUrl: projectPageUrl(project.id, ruleset.id),
			caseId: project.id,
			rulesets: RULESETS.map((option) => ({ value: option.id, text: option.name, checked: option.id === ruleset.id }))
		};

		return res.render('views/consultees/ruleset/view.njk', viewModel);
	};
}

/**
 * "Save and return" on the ruleset picker: store nothing server-side - the choice lives in the
 * map page URL it redirects to. An unrecognised value just returns to the picker unchanged.
 */
export function buildRulesetPickerSubmit(): AsyncRequestHandlerWithBody<{ ruleset?: unknown }> {
	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		if (!isCaseId(caseId)) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		const ruleset = getRuleset(firstQueryValue(req.body?.ruleset));
		if (!ruleset) {
			res.redirect(pickerUrl(caseId, RULESETS[0].id));
			return;
		}

		res.redirect(projectPageUrl(caseId, ruleset.id));
	};
}
