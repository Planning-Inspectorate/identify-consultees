import type { ManageService } from '#service';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import type { ConsulteeAreasPythonViewModel } from './view-model.ts';

const VIEW = 'views/consultee-areas-python/view.njk';
const PAGE_HEADING = 'Consultee areas (via Python function)';

export function buildConsulteeAreasPythonPage(): AsyncRequestHandler {
	return async (req, res) => {
		const viewModel: ConsulteeAreasPythonViewModel = { pageHeading: PAGE_HEADING };
		return res.render(VIEW, viewModel);
	};
}

export function buildRunConsulteeAreasPython(service: ManageService): AsyncRequestHandler {
	const { logger } = service;
	return async (req, res) => {
		const viewModel: ConsulteeAreasPythonViewModel = { pageHeading: PAGE_HEADING };

		try {
			const response = await fetch(service.pythonFunctionUrl);
			if (!response.ok) {
				throw new Error(`Python function responded with status ${response.status}`);
			}
			const body = await response.json();
			viewModel.rows = body.rows;
		} catch (error) {
			logger.error({ error }, 'Failed to call Python function');
			viewModel.error = 'Could not reach the Python function.';
		}

		return res.render(VIEW, viewModel);
	};
}
