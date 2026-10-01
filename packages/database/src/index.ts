import type { Prisma } from '@pins/identify-consultees-database/src/client/client.d.ts';
import { PrismaClient } from '@pins/identify-consultees-database/src/client/client.ts';
import type { DatabaseConfig } from '@planning-inspectorate/core/app';
import { PrismaMssql } from '@prisma/adapter-mssql';
import type { Logger } from 'pino';

// A ruleset run does ~34 real geography (STDistance/STIntersects) queries, not one - on a
// compute-constrained SQL tier (e.g. Dev's Basic/5-DTU database) that's comfortably enough to push
// some of them past the driver's default ~15s request timeout, confirmed for real against Dev:
// every query there was timing out outright, not just occasionally. The app's own queries are
// still small and indexed - it's the tier's available compute, not the query shape, that's the
// constraint - so a longer timeout here just lets a genuinely-slow-but-working query finish
// instead of aborting it arbitrarily at 15s.
const APP_REQUEST_TIMEOUT_MS = 45_000;

export function initDatabaseClient(
	config: { database: DatabaseConfig; NODE_ENV: string },
	logger: Logger
): PrismaClient {
	let prismaLogger: Logger | undefined;

	if (config.NODE_ENV !== 'production') {
		prismaLogger = logger;
	}

	if (!config.database.connectionString) {
		throw new Error('database connectionString is required');
	}

	return newDatabaseClient(withExtendedTimeout(config.database.connectionString, APP_REQUEST_TIMEOUT_MS), prismaLogger);
}

/**
 * Extend a SQL_CONNECTION_STRING's request timeout - for long-running bulk operations (seeding,
 * large real-data imports) and for the running app itself (see APP_REQUEST_TIMEOUT_MS above).
 *
 * `@prisma/adapter-mssql`'s own connection-string parser maps `socketTimeout` (ms) to the
 * underlying driver's request timeout - the default (~15s) is comfortably enough for a single
 * small, indexed query in isolation, but not for a single MERGE statement carrying a large/complex
 * real geometry (confirmed: seeding real reference data against a real, network-distant SQL Server
 * timed out even at a batch size of 5 rows), nor for a query queued behind others on a
 * compute-constrained tier.
 */
export function withExtendedTimeout(connectionString: string, timeoutMs: number): string {
	return `${connectionString};socketTimeout=${timeoutMs}`;
}

export function newDatabaseClient(connectionString: string, logger?: Logger): PrismaClient {
	const adapter = new PrismaMssql(connectionString);
	const prisma = new PrismaClient({
		adapter,
		log: [
			{
				emit: 'event',
				level: 'query'
			},
			{
				emit: 'event',
				level: 'error'
			},
			{
				emit: 'event',
				level: 'info'
			},
			{
				emit: 'event',
				level: 'warn'
			}
		]
	});

	if (logger) {
		const logQuery = (e: Prisma.QueryEvent) => {
			logger.debug({ query: e.query, params: e.params, duration: e.duration }, 'Prisma query');
		};

		const logError = (e: Prisma.LogEvent) => logger.error({ e }, 'Prisma error');
		const logInfo = (e: Prisma.LogEvent) => logger.debug({ e });
		const logWarn = (e: Prisma.LogEvent) => logger.warn({ e });

		prisma.$on('query', logQuery);
		prisma.$on('error', logError);
		prisma.$on('info', logInfo);
		prisma.$on('warn', logWarn);
	}

	return prisma;
}
