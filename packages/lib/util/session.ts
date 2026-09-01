import type { Request, RequestHandler } from 'express';
import session from 'express-session';
import lusca from 'lusca';
import type { RedisClient } from '../redis/redis-client.ts';

const DEFAULT_SESSION_FIELD = 'cases';

type SessionFieldData = Record<string, Record<string, unknown>>;
type SessionRecord = Record<string, SessionFieldData>;

interface InitSessionOptions {
	redis: RedisClient | null;
	secure: boolean;
	secret: string;
}

function initSessionMiddleware({ redis, secure, secret }: InitSessionOptions): RequestHandler {
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
			maxAge: 86_400_000
		}
	});
}

/**
 * Initialise session middleware with CSRF included
 */
export function initSessionMiddlewareWithCsrf(opts: {
	redis: RedisClient | null;
	secret: string;
	secure: boolean;
}): RequestHandler[] {
	return [initSessionMiddleware(opts), lusca.csrf()];
}

/**
 * Add data to a session, by id and field
 */
export function addSessionData(
	req: Request,
	id: string,
	data: Record<string, unknown>,
	sessionField: string = DEFAULT_SESSION_FIELD
) {
	if (!req.session) {
		throw new Error('request session required');
	}
	const session = req.session as unknown as SessionRecord;
	const field = session[sessionField] || (session[sessionField] = {});
	const fieldProps = field[id] || (field[id] = {});
	Object.assign(fieldProps, data);
}

/**
 * Read a value from the session
 */
export function readSessionData<T>(
	req: Request,
	id: string,
	field: string,
	defaultValue: T,
	sessionField: string = DEFAULT_SESSION_FIELD
): T | boolean {
	if (!req.session) {
		return false;
	}
	const sessionFieldData = req.session[sessionField] as SessionFieldData | undefined;
	const fieldProps: Record<string, unknown> = (sessionFieldData && sessionFieldData[id]) || {};
	return (fieldProps[field] as T) || defaultValue;
}

/**
 * Clear a case updated flag from the session
 */
export function clearSessionData(
	req: Request,
	id: string,
	fieldOrFields: string | string[],
	sessionField: string = DEFAULT_SESSION_FIELD
) {
	if (!req.session) {
		return; // no need to error here
	}
	const sessionFieldData = req.session[sessionField] as SessionFieldData | undefined;
	if (fieldOrFields instanceof Array) {
		fieldOrFields.forEach((field) => {
			const fieldProps: Record<string, unknown> = (sessionFieldData && sessionFieldData[id]) || {};
			delete fieldProps[field];
		});
		return;
	}

	const fieldProps: Record<string, unknown> = (sessionFieldData && sessionFieldData[id]) || {};
	delete fieldProps[fieldOrFields];
}
