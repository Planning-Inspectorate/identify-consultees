import { clientAddressKey } from '#util/client-address.ts';
import { getAccount } from '@planning-inspectorate/core/auth';
import type { Request, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';

export type EndpointRateLimiterOptions = {
	windowMs?: number;
	limit?: number;
};

/**
 * Whose bucket a request spends: the signed-in account's object id, else the real client address
 * (see clientAddressKey). The routes these limiters guard sit behind sign-in, and staff mostly
 * share a handful of VPN and office egress addresses - keying on address alone would put everyone
 * behind one in one bucket. An account key gives each person their own, and a script with no
 * session still gets throttled per address.
 */
function accountOrClientAddressKey(req: Request): string {
	return getAccount(req.session)?.localAccountId ?? clientAddressKey(req);
}

/**
 * The shared shape for the app's limiters: draft-8 RateLimit headers, and a bucket per account
 * (see accountOrClientAddressKey). X-Forwarded-For validation stays off because tests and local
 * setups omit it.
 *
 * The default - 240 requests a minute - is far above what a person can drive through the
 * expensive routes it guards (map renders, the report download, the ruleset run), so it only
 * bites scripted storms, not use.
 */
export function buildEndpointRateLimiter(options: EndpointRateLimiterOptions = {}): RequestHandler {
	return rateLimit({
		windowMs: options.windowMs ?? 60_000,
		limit: options.limit ?? 240,
		standardHeaders: 'draft-8',
		legacyHeaders: false,
		keyGenerator: accountOrClientAddressKey,
		validate: { xForwardedForHeader: false }
	});
}
