import type { RedisClientType, RedisClusterType } from 'redis';

export class MSALCacheClient {
	private readonly redisClient: RedisClusterType | RedisClientType;

	constructor(redisClient: RedisClusterType | RedisClientType) {
		this.redisClient = redisClient;
	}

	async get(key: string): Promise<string> {
		return ((await this.redisClient.get(key)) as string | null) ?? '';
	}

	async set(key: string, value: string): Promise<string> {
		return ((await this.redisClient.set(key, value)) as string) ?? '';
	}
}
