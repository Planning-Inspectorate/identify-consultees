import type { ManageService } from '#service';
import { listCaseBoundaryFiles } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { AsyncRequestHandler, AsyncRequestHandlerWithBody } from '@planning-inspectorate/core/util';
import { resolveCaseSummary } from '../resolve-case.ts';
import { firstQueryValue, projectPageUrl, selectedRuleset } from '../run-ruleset.ts';
import { formatUploadedAt } from './format-uploaded.ts';
import type { ShapefileOption, ShapefilePickerViewModel } from './view-model.ts';

function pickerUrl(caseId: string, rulesetId: string): string {
	return `/consultees/${encodeURIComponent(caseId)}/shapefile?ruleset=${encodeURIComponent(rulesetId)}`;
}

function toOption(
	file: { id: string; fileName: string | null; receivedDate: Date | null },
	selectedId: string | undefined
): ShapefileOption {
	return {
		value: file.id,
		text: file.fileName ?? 'Unnamed file',
		...(file.receivedDate ? { hint: { text: `Uploaded: ${formatUploadedAt(file.receivedDate)}` } } : {}),
		checked: file.id === selectedId
	};
}

/**
 * The map page's "Change shapefile" page: every stored boundary file for the project (a
 * caseReference can have several submissions over time - see listCaseBoundaryFiles), the current
 * one - or the top option - pre-checked. "Save and return" posts back here and redirects to the
 * map page for the chosen file's own case_boundary id, which re-runs and re-renders the map from
 * that boundary.
 */
export function buildShapefilePickerPage(service: ManageService): AsyncRequestHandler {
	const { db } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const project = await resolveCaseSummary(db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		const ruleset = selectedRuleset(req.query.ruleset);
		const files = await listCaseBoundaryFiles(db, project.reference);
		const selectedId = files.some((file) => file.id === caseId) ? caseId : files[0]?.id;

		const viewModel: ShapefilePickerViewModel = {
			pageHeading: 'Project shapefile',
			backLinkUrl: projectPageUrl(project.id, ruleset.id),
			caseId: project.id,
			rulesetId: ruleset.id,
			files: files.map((file) => toOption(file, selectedId))
		};

		return res.render('views/consultees/shapefile/view.njk', viewModel);
	};
}

/**
 * "Save and return" on the shapefile picker. The chosen id must be one of this project's own
 * files - anything else (or a missing selection) just returns to the picker unchanged.
 */
export function buildShapefilePickerSubmit(
	service: ManageService
): AsyncRequestHandlerWithBody<{ ruleset?: unknown; shapefile?: unknown }> {
	const { db } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const project = await resolveCaseSummary(db, caseId);
		if (!project) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		const ruleset = selectedRuleset(req.body?.ruleset);
		const files = await listCaseBoundaryFiles(db, project.reference);
		const chosen = files.find((file) => file.id === firstQueryValue(req.body?.shapefile));
		if (!chosen) {
			res.redirect(pickerUrl(project.id, ruleset.id));
			return;
		}

		res.redirect(projectPageUrl(chosen.id, ruleset.id));
	};
}
