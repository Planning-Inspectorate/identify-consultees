import type { Configuration } from '@azure/msal-node';
import { LogLevel } from '@azure/msal-node';
import { getAccount } from '@planning-inspectorate/core/auth';
import type { Request } from 'express';
import type { Logger } from 'pino';
import type { Config } from '../app/config.ts';

export function buildMsalConfig({ config, logger }: { config: Config['auth']; logger: Logger }): Configuration {
	return {
		auth: {
			authority: config.authority,
			clientId: config.clientId,
			clientSecret: config.clientSecret
		},
		system: {
			loggerOptions: {
				/**
				 * @param {LogLevel} logLevel
				 * @param {string} message
				 * */
				loggerCallback(logLevel, message) {
					switch (logLevel) {
						case LogLevel.Error:
							logger.error(message);
							break;

						case LogLevel.Warning:
							logger.warn(message);
							break;

						case LogLevel.Info:
							logger.info(message);
							break;

						case LogLevel.Verbose:
							logger.debug(message);
							break;

						default:
							logger.trace(message);
					}
				},
				piiLoggingEnabled: false,
				logLevel: LogLevel.Warning
			}
		}
	};
}

/**
 * Who is acting, for audit log lines on the /admin routes: the signed-in Entra account's
 * username and object id, or 'unknown' when auth is disabled (local dev) or the session
 * carries no account.
 */
export function auditActor(req: Request): { userId?: string; username: string } {
	const account = getAccount(req.session);
	if (!account) {
		return { username: 'unknown' };
	}
	return { userId: account.localAccountId, username: account.username };
}
