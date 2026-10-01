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

		if (!service.pythonFunctionUrl) {
			logger.error('PYTHON_FUNCTION_URL is not configured');
			viewModel.error = 'Could not reach the Python function.';
			return res.render(VIEW, viewModel);
		}

		try {
			// the function requires an x-api-key shared secret (see function_app.py); a missing
			// key on either side fails closed with 401/500, which surfaces as the same error
			const headers = service.pythonFunctionApiKey ? { 'x-api-key': service.pythonFunctionApiKey } : undefined;
			const response = await fetch(service.pythonFunctionUrl, {
				headers,
				// don't let a hung function request hang the page request indefinitely
				signal: AbortSignal.timeout(15_000)
			});
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
