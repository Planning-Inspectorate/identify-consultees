import type { ManageService } from '#service';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { checkCbosConnection, importCaseBoundariesFromCbos } from './cbos-boundaries.ts';
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

/**
 * Import every CBOS boundary. If it fails, the function's CBOS connection check says why - no
 * sign-in to CBOS's database (each environment's function app needs a user there, made in SQL),
 * no route to it, or no access to its documents - so the page can, rather than just that it did.
 */
export function buildRunImportFromCbos(
	service: ManageService,
	runImport: typeof importCaseBoundariesFromCbos = importCaseBoundariesFromCbos,
	checkConnection: typeof checkCbosConnection = checkCbosConnection
): AsyncRequestHandler {
	const { db, logger } = service;

	return async (req, res) => {
		const viewModel: ImportFromCbosViewModel = { pageHeading: PAGE_HEADING };
		const options = { pythonFunctionUrl: service.pythonFunctionUrl, apiKey: service.pythonFunctionApiKey };

		try {
			const result = await runImport(db, options);
			Object.assign(viewModel, result);
			if (result.failures.length > 0) {
				logger.warn({ failures: result.failures }, 'Some CBOS boundary files could not be imported');
			}
		} catch (error) {
			viewModel.error = 'Could not import case boundaries from CBOS.';
			viewModel.cause = error instanceof Error ? error.message : String(error);
			viewModel.connection = await checkConnection(options);
			logger.error({ error, connection: viewModel.connection }, 'Failed to import case boundaries from CBOS');
		}

		return res.render(VIEW, await withLoadedCounts(service, viewModel));
	};
}
