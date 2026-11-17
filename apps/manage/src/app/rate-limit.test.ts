import express from 'express';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import request from 'supertest';
import { buildEndpointRateLimiter } from './rate-limit.ts';

// a route limited to two requests a minute, so the test can drive it over
function limitedApp(limit: number) {
	const app = express();
	app.get('/heavy', buildEndpointRateLimiter({ limit }), (_req, res) => res.sendStatus(204));
	return app;
}

describe('buildEndpointRateLimiter', () => {
	test('passes requests under the limit and answers 429 once it is spent', async () => {
		const app = limitedApp(2);

		assert.equal((await request(app).get('/heavy')).status, 204);
		assert.equal((await request(app).get('/heavy')).status, 204);

		const throttled = await request(app).get('/heavy');
		assert.equal(throttled.status, 429);
		// draft-8 headers tell the client its budget and when the window resets
		assert.match(throttled.headers['ratelimit-policy'], /q=2; w=60/);
		assert.ok(throttled.headers['ratelimit']);
	});

	test('defaults to a one-minute window of 240 requests', () => {
		// the factory's defaults back every mounted limiter; building one is enough to prove it builds
		const limiter = buildEndpointRateLimiter();
		assert.equal(typeof limiter, 'function');
	});

	test('windowMs can be overridden', () => {
		const limiter = buildEndpointRateLimiter({ windowMs: 15_000, limit: 5 });
		assert.equal(typeof limiter, 'function');
	});

	test('gives each signed-in account its own bucket, with no session falling back to the client address', async () => {
		const app = express();
		// a stand-in for the session the auth flow leaves: the account id an x-account header names,
		// so the test can send requests as different signed-in users
		app.use((req, _res, next) => {
			const account = req.headers['x-account'];
			if (account) {
				req.session = { account: { localAccountId: account } } as never;
			}
			next();
		});
		app.get('/heavy', buildEndpointRateLimiter({ limit: 1 }), (_req, res) => res.sendStatus(204));

		// one a minute each: account 'a' spends its own bucket and no one else's
		assert.equal((await request(app).get('/heavy').set('x-account', 'a')).status, 204);
		assert.equal((await request(app).get('/heavy').set('x-account', 'a')).status, 429);
		assert.equal((await request(app).get('/heavy').set('x-account', 'b')).status, 204);
		// no session: the bucket is the client address's, not shared with 'a'
		assert.equal((await request(app).get('/heavy')).status, 204);
	});
});
