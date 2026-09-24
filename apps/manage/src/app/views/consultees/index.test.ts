import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { createManageTestService } from '../../testing/create-test-app.ts';
import { createRoutes } from './index.ts';

describe('consultees routes', () => {
	test('redirects home when geometryId is a non-string array value', async () => {
		const service = createManageTestService(true);
		try {
			const router = createRoutes(service);
			const layer = router.stack.find((entry) => entry.route?.path === '/');
			assert.ok(layer?.route);
			const handler = layer.route.stack[0].handle;
			const res = { redirect: mock.fn() };

			handler({ query: { geometryId: [1] } }, res);
			assert.equal(res.redirect.mock.calls[0].arguments[0], '/');

			handler({ query: { geometryId: 'geo-1' } }, res);
			assert.equal(res.redirect.mock.calls[1].arguments[0], '/consultees/geo-1');

			handler({ query: { geometryId: 'geo-1', ruleset: ['post-30-apr-2024-england-wales'] } }, res);
			assert.equal(res.redirect.mock.calls[2].arguments[0], '/consultees/geo-1?ruleset=post-30-apr-2024-england-wales');
		} finally {
			await service.db.$disconnect().catch(() => undefined);
		}
	});
});
