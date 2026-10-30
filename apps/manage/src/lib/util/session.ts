import type { RequestHandler } from 'express';
import session, { type SessionOptions } from 'express-session';
import type { IRedisClient } from '../redis/index.ts';

export interface InitSessionOptions extends Omit<SessionOptions, 'cookie'> {
	redis: IRedisClient | null;
	secure: boolean;
	secret: string | string[];
	/**
	 * Defaults to 24 hours
	 */
	maxAge?: number;
}

export function initSessionMiddleware({
	redis,
	secure,
	secret,
	maxAge,
	...options
}: InitSessionOptions): RequestHandler {
	let store;
	if (redis) {
		store = redis.store;
	} else {
		store = new session.MemoryStore();
	}

	return session({
		secret: secret,
		resave: false,
		saveUninitialized: false,
		store,
		unset: 'destroy',
		cookie: {
			secure,
			sameSite: 'lax',
			maxAge: maxAge ?? 86_400_000
		},
		...options
	});
}
