import type { ManageService } from '#service';
import { fetchWithTimeout, type AsyncRequestHandler } from '@planning-inspectorate/core/util';
import type { CbosCheck, CbosConnectionViewModel } from './view-model.ts';

const VIEW = 'views/admin-cbos-connection/view.njk';
const PAGE_HEADING = 'Check the CBOS connection';
// the function signs in to CBOS's database and storage in turn, each with its own 15s login limit
const CHECK_TIMEOUT_MS = 45_000;

/**
 * The function's cbos/health route. PYTHON_FUNCTION_URL names the consultee-areas route, so this
 * is resolved as its sibling under the same `/api/` - as run-ruleset is (see ruleset-runner.ts).
 */
export function cbosHealthUrl(pythonFunctionUrl: string): string {
	return new URL('cbos/health', pythonFunctionUrl).toString();
}

function isCheck(value: unknown): value is CbosCheck {
	const check = value as CbosCheck | undefined;
	return (check?.status === 'OK' || check?.status === 'ERROR') && typeof check.detail === 'string';
}

export function buildCbosConnectionPage(): AsyncRequestHandler {
	return async (req, res) => {
		const viewModel: CbosConnectionViewModel = { pageHeading: PAGE_HEADING };
		return res.render(VIEW, viewModel);
	};
}

export function buildRunCbosConnectionCheck(service: ManageService): AsyncRequestHandler {
	const { logger } = service;
	return async (req, res) => {
		const viewModel: CbosConnectionViewModel = { pageHeading: PAGE_HEADING };
		if (!service.pythonFunctionUrl) {
			logger.error('PYTHON_FUNCTION_URL is not configured');
			viewModel.error = 'Could not reach the Python function: it is not configured.';
			return res.render(VIEW, viewModel);
		}

		try {
			const headers = service.pythonFunctionApiKey ? { 'x-api-key': service.pythonFunctionApiKey } : undefined;
			const response = await fetchWithTimeout(
				cbosHealthUrl(service.pythonFunctionUrl),
				{ timeoutMs: CHECK_TIMEOUT_MS },
				{ headers }
			);
			// 200 and 503 both carry a result for each part; anything else is the function itself refusing
			const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
			if (isCheck(body.database) && isCheck(body.storage)) {
				viewModel.database = body.database;
				viewModel.storage = body.storage;
			} else if (typeof body.error === 'string') {
				viewModel.error = `The Python function could not run the check (status ${response.status}): ${body.error}`;
			} else {
				viewModel.error = `The Python function could not run the check (status ${response.status}).`;
			}
		} catch (error) {
			logger.error({ error }, 'Failed to call the Python function CBOS check');
			viewModel.error = 'Could not reach the Python function.';
		}
		return res.render(VIEW, viewModel);
	};
}
