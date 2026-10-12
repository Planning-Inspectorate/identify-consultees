import type { ManageService } from '#service';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { importCaseBoundariesFromCbos } from '../../cbos-boundaries.ts';
import type { ImportFromCbosViewModel } from './view-model.ts';

const VIEW = 'views/admin-import-from-cbos/view.njk';
const PAGE_HEADING = 'Import case boundaries from CBOS';

/**
 * Case boundaries loaded now, and how many came from CBOS. An import of every CBOS boundary can
 * outlast Front Door's response timeout - the browser then shows an error while the import carries
 * on - so the page shows these to confirm when it's finished. A failure just leaves them off.
 */
async function withLoadedCounts(
	service: Pick<ManageService, 'db' | 'logger'>,
	viewModel: ImportFromCbosViewModel
): Promise<ImportFromCbosViewModel> {
	try {
		const [counts] = await service.db.$queryRaw<{ total: number; fromCbos: number }[]>`
			SELECT COUNT(*) AS total,
				COALESCE(SUM(CASE WHEN JSON_VALUE(metadata, '$.source') = 'cbos' THEN 1 ELSE 0 END), 0) AS fromCbos
			FROM case_boundary
		`;
		return { ...viewModel, loadedCaseBoundaries: counts.total, loadedFromCbos: counts.fromCbos };
	} catch (error) {
		service.logger.warn({ error }, 'Could not count the loaded case boundaries');
		return viewModel;
	}
}

export function buildImportFromCbosPage(service: ManageService): AsyncRequestHandler {
	return async (req, res) => {
		return res.render(VIEW, await withLoadedCounts(service, { pageHeading: PAGE_HEADING }));
	};
}

export function buildRunImportFromCbos(
	service: ManageService,
	runImport: typeof importCaseBoundariesFromCbos = importCaseBoundariesFromCbos
): AsyncRequestHandler {
	const { db, logger } = service;

	return async (req, res) => {
		const viewModel: ImportFromCbosViewModel = { pageHeading: PAGE_HEADING };

		try {
			const result = await runImport(db, {
				pythonFunctionUrl: service.pythonFunctionUrl,
				apiKey: service.pythonFunctionApiKey
			});
			Object.assign(viewModel, result);
			if (result.failures.length > 0) {
				logger.warn({ failures: result.failures }, 'Some CBOS boundary files could not be imported');
			}
		} catch (error) {
			logger.error({ error }, 'Failed to import case boundaries from CBOS');
			viewModel.error = 'Could not import case boundaries from CBOS.';
		}

		return res.render(VIEW, await withLoadedCounts(service, viewModel));
	};
}
