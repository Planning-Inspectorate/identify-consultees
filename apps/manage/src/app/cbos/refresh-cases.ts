import type { ManageService } from '#service';
import { importCaseBoundariesFromCbos, importDb } from './cbos-boundaries.ts';

export interface CbosCaseRefresh {
	/** Starts an import of every CBOS boundary, unless one is running - false then. Never waits for it. */
	start: () => boolean;
}

/**
 * The search page's Refresh cases button: imports CBOS's new and changed boundaries straight from CBOS,
 * without waiting for the schedule or a Service Bus event - those already saved at their version
 * aren't fetched again, so it's quick when little has changed. It runs in the background - a first
 * import can take several minutes, longer than Front Door waits for a response - and one at a time,
 * however often the button is pressed. Failures are logged, never thrown.
 */
export function createCbosCaseRefresh(
	service: Pick<ManageService, 'db' | 'logger' | 'pythonFunctionUrl' | 'pythonFunctionApiKey'> &
		Partial<Pick<ManageService, 'bulkDb'>>,
	runImport: typeof importCaseBoundariesFromCbos = importCaseBoundariesFromCbos
): CbosCaseRefresh {
	const { logger } = service;
	// only what's new or changed since the last import - the schedule and the admin import fetch
	// every file again, so a boundary saved wrongly is put right there
	const options = {
		pythonFunctionUrl: service.pythonFunctionUrl,
		apiKey: service.pythonFunctionApiKey,
		onlyNewOrChanged: true
	};
	let running = false;

	const refresh = async () => {
		try {
			const result = await runImport(importDb(service), options);
			logger.info(
				{
					filesFound: result.filesFound,
					unchanged: result.unchanged,
					imported: result.imported,
					casesImported: result.casesImported,
					removed: result.removed
				},
				'Refreshed cases from CBOS'
			);
			if (result.removalSkipped) {
				logger.warn({ reason: result.removalSkipped }, 'CBOS import removed no boundaries');
			}
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
