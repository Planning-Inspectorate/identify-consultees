import type { ManageService } from '#service';
import { RULESETS } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { resolveCaseSummary } from '../resolve-case.ts';
import type { RulesetPickerViewModel } from './view-model.ts';

/**
 * Step 2 of the identify-consultees flow: having picked a project, pick a ruleset to run against
 * it. See views/consultees/results/controller.ts for step 3 (running it).
 */
export function buildRulesetPickerPage(service: ManageService): AsyncRequestHandler {
	const { db } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		// this page never touches the project's geometry - only the results page does, to run the
		// ruleset - so it looks up the lighter summary rather than fetching/parsing a boundary shape
		const project = await resolveCaseSummary(db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		const viewModel: RulesetPickerViewModel = {
			pageHeading: `Choose a ruleset for ${project.caseName} (${project.reference})`,
			backLinkUrl: '/',
			caseId: project.id,
			reference: project.reference,
			caseName: project.caseName,
			rulesets: RULESETS.map((ruleset) => ({ value: ruleset.id, text: ruleset.name }))
		};

		return res.render('views/consultees/ruleset/view.njk', viewModel);
	};
}
