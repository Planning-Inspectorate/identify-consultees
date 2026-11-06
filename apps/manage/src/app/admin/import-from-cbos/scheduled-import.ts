import type { ManageService } from '#service';
import { importCaseBoundariesFromCbos, importDb } from '../../cbos/cbos-boundaries.ts';

// how often the clock is looked at - an import starts within a minute of its hour
const CHECK_EVERY_MS = 60_000;
// an hour's import still starts this long after the hour (a restart at 10:05), but not later (a
// deploy at 10:50 waits for the next one)
const START_WITHIN_MINUTES = 15;

const ukClock = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Europe/London',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
});

/** The UK date, hour and minute at `now` - British Summer Time or not. */
export function ukTime(now: Date): { date: string; hour: number; minute: number } {
	const part = Object.fromEntries(ukClock.formatToParts(now).map(({ type, value }) => [type, value]));
	return { date: `${part.year}-${part.month}-${part.day}`, hour: Number(part.hour), minute: Number(part.minute) };
}

/** Which import is due at `now` ("2026-11-02 10") - undefined between them. */
export function dueImport(hours: number[], now: Date): string | undefined {
	const { date, hour, minute } = ukTime(now);
	return hours.includes(hour) && minute < START_WITHIN_MINUTES ? `${date} ${String(hour).padStart(2, '0')}` : undefined;
}

export interface ScheduledImportDependencies {
	runImport: typeof importCaseBoundariesFromCbos;
	now: () => Date;
	setInterval: (callback: () => void, ms: number) => { unref: () => unknown };
	clearInterval: (timer: ReturnType<ScheduledImportDependencies['setInterval']>) => void;
}

const DEFAULT_DEPENDENCIES: ScheduledImportDependencies = {
	runImport: importCaseBoundariesFromCbos,
	now: () => new Date(),
	setInterval: (callback, ms) => setInterval(callback, ms),
	clearInterval: (timer) => clearInterval(timer as NodeJS.Timeout)
};

/**
 * Import every CBOS boundary at each of `service.cbosImportHours` (UK time), as the admin page's
 * button does, so new cases, boundaries and stages arrive without anyone pressing it. Each hour's
 * import runs once; one still running when the next is due isn't started again. Failures are
 * logged, never thrown - the next hour tries again. Returns a stop function, or undefined when no
 * hours are set (off).
 */
export function startScheduledCbosImport(
	service: Pick<ManageService, 'db' | 'logger' | 'pythonFunctionUrl' | 'pythonFunctionApiKey' | 'cbosImportHours'> &
		Partial<Pick<ManageService, 'bulkDb'>>,
	dependencies: ScheduledImportDependencies = DEFAULT_DEPENDENCIES
): (() => void) | undefined {
	const { logger, cbosImportHours: hours } = service;
	if (hours.length === 0) {
		return undefined;
	}
	const options = { pythonFunctionUrl: service.pythonFunctionUrl, apiKey: service.pythonFunctionApiKey };
	let lastImport: string | undefined;
	let running = false;

	const check = async () => {
		const due = dueImport(hours, dependencies.now());
		if (!due || due === lastImport || running) {
			return;
		}
		lastImport = due;
		running = true;
		try {
			const result = await dependencies.runImport(importDb(service), options);
			logger.info(
				{ filesFound: result.filesFound, imported: result.imported, casesImported: result.casesImported },
				'Scheduled CBOS import finished'
			);
			if (result.failures.length > 0) {
				logger.warn({ failures: result.failures }, 'Some CBOS boundary files could not be imported');
			}
		} catch (error) {
			logger.error({ error }, 'Scheduled CBOS import failed');
		} finally {
			running = false;
		}
	};

	const timer = dependencies.setInterval(() => void check(), CHECK_EVERY_MS);
	// don't keep the process alive for it
	timer.unref();
	logger.info({ hours }, 'CBOS boundaries will be imported at these hours, UK time');
	return () => dependencies.clearInterval(timer);
}
