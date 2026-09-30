import type { Prisma } from '@pins/identify-consultees-database/src/client/client.d.ts';
import { PrismaClient } from '@pins/identify-consultees-database/src/client/client.ts';
import type { DatabaseConfig } from '@planning-inspectorate/core/app';
import { PrismaMssql } from '@prisma/adapter-mssql';
import type { Logger } from 'pino';

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

	return newDatabaseClient(config.database.connectionString, prismaLogger);
}

/**
 * Extend a SQL_CONNECTION_STRING's request timeout for long-running bulk operations (seeding,
 * large real-data imports) - never for the running app itself, which should keep failing fast on
 * a genuinely slow/stuck query.
 *
 * `@prisma/adapter-mssql`'s own connection-string parser maps `socketTimeout` (ms) to the
 * underlying driver's request timeout - the default (~15s) is comfortably enough for the app's own
 * small, indexed queries, but not for a single MERGE statement carrying a large/complex real
 * geometry (confirmed: seeding real reference data against a real, network-distant SQL Server
 * timed out even at a batch size of 5 rows - one geometry alone can take longer than that).
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
