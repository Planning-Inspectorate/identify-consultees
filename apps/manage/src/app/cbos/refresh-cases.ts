import type { ManageService } from '#service';
import { importCaseBoundariesFromCbos } from './cbos-boundaries.ts';

export interface CbosCaseRefresh {
	/** Starts an import of every CBOS boundary, unless one is running - false then. Never waits for it. */
	start: () => boolean;
}

/**
 * The search page's Refresh cases button: imports every CBOS boundary straight from CBOS, as the admin
 * import does, without waiting for the schedule or a Service Bus event. It runs in the background - it
 * can take several minutes, longer than Front Door waits for a response - and one at a time, however
 * often the button is pressed. Failures are logged, never thrown.
 */
export function createCbosCaseRefresh(
	service: Pick<ManageService, 'db' | 'logger' | 'pythonFunctionUrl' | 'pythonFunctionApiKey'>,
	runImport: typeof importCaseBoundariesFromCbos = importCaseBoundariesFromCbos
): CbosCaseRefresh {
	const { db, logger } = service;
	const options = { pythonFunctionUrl: service.pythonFunctionUrl, apiKey: service.pythonFunctionApiKey };
	let running = false;

	const refresh = async () => {
		try {
			const result = await runImport(db, options);
			logger.info(
				{ filesFound: result.filesFound, imported: result.imported, casesImported: result.casesImported },
				'Refreshed cases from CBOS'
			);
			if (result.failures.length > 0) {
				logger.warn({ failures: result.failures }, 'Some CBOS boundary files could not be imported');
			}
		} catch (error) {
			logger.error({ error }, 'Failed to refresh cases from CBOS');
		} finally {
			running = false;
		}
	};

	return {
		start: () => {
			if (running) {
				return false;
			}
			running = true;
			void refresh();
			return true;
		}
	};
}
