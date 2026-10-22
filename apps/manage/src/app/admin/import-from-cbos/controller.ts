import type { ManageService } from '#service';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { importCaseBoundariesFromCbos } from '../../cbos/cbos-boundaries.ts';
import type { ImportFromCbosViewModel } from './view-model.ts';

const VIEW = 'admin/import-from-cbos/view.njk';
const PAGE_HEADING = 'Import cases from CBOS';

/**
 * The cases and case boundaries in the database now, in all and from CBOS. An import of every CBOS
 * boundary can outlast Front Door's response timeout - the browser then shows an error while the
 * import carries on - so the page shows these to confirm when it's finished. A failure just leaves
 * them off.
 */
async function withLoadedCounts(
	service: Pick<ManageService, 'db' | 'logger'>,
	viewModel: ImportFromCbosViewModel
): Promise<ImportFromCbosViewModel> {
	try {
		const [loaded] = await service.db.$queryRaw<NonNullable<ImportFromCbosViewModel['loaded']>[]>`
			SELECT
				COUNT(DISTINCT caseReference) AS cases,
				COUNT(*) AS boundaries,
				COUNT(DISTINCT CASE WHEN JSON_VALUE(metadata, '$.source') = 'cbos' THEN caseReference END) AS casesFromCbos,
				COALESCE(SUM(CASE WHEN JSON_VALUE(metadata, '$.source') = 'cbos' THEN 1 ELSE 0 END), 0) AS boundariesFromCbos
			FROM case_boundary
		`;
		return { ...viewModel, loaded };
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
