import { Router as createRouter, type IRouter, type Request, type Response } from 'express';
import type { BaseLogger } from 'pino';
import { cacheNoStoreMiddleware } from '../middleware/cache.ts';
import { asyncHandler, type AsyncRequestHandler } from '../util/async-handler.ts';

interface DatabaseClient {
	$queryRaw: (query: TemplateStringsArray) => Promise<void>;
}

interface MonitoringRoutesOptions {
	logger: BaseLogger;
	dbClient?: DatabaseClient;
	gitSha?: string;
}

export function createMonitoringRoutes({ gitSha, dbClient, logger }: MonitoringRoutesOptions): IRouter {
	const router = createRouter();

	const handleHealthCheck = buildHandleHeathCheck(logger, dbClient, gitSha);
	router.use(cacheNoStoreMiddleware); // don't store monitoring responses, always get fresh data
	router.head('/', asyncHandler(handleHeadHealthCheck));
	router.get('/health', asyncHandler(handleHealthCheck));

	return router;
}

export function handleHeadHealthCheck(_: Request, response: Response): void {
	// no-op - HEAD mustn't return a body
	response.sendStatus(200);
}

export function buildHandleHeathCheck(
	logger: BaseLogger,
	dbClient?: DatabaseClient,
	gitSha?: string
): AsyncRequestHandler {
	return async (_, response) => {
		let database = 'NOT_CONFIGURED';
		if (dbClient) {
			try {
				await dbClient.$queryRaw`SELECT 1`;
				database = 'OK';
			} catch (e) {
				logger.warn(e, 'database connection error');
				database = 'ERROR'; // should this be a different response code?
			}
		}
		response.status(200).send({
			status: 'OK',
			uptime: process.uptime(),
			commit: gitSha,
			database: database
		});
	};
}
