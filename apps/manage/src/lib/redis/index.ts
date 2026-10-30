import type { Logger } from 'pino';
import { LegacyRedisClient } from './redis-client-legacy.ts';
import { RedisClient } from './redis-client.ts';

interface RedisConfig {
	redis?: string;
	redisPrefix: string;
}

export function initRedis(config: RedisConfig, logger: Logger): IRedisClient | null {
	if (!config.redis) {
		return null;
	}
	if (config.redis?.startsWith('rediss://')) {
		return new RedisClient(config.redis, logger, config.redisPrefix);
	}
	return new LegacyRedisClient(config.redis, logger, config.redisPrefix);
}

export type IRedisClient = RedisClient | LegacyRedisClient;

export * from './msal-cache-client.ts';
export * from './partition-manager.ts';
export * from './redis-client-legacy.ts';
export * from './redis-client.ts';
