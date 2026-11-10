import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { buildAssertAdminAccess, canUseAdmin } from './access.ts';

const ADMIN_GROUP = 'admin-group-id';

function service({ authDisabled = false, admin = ADMIN_GROUP } = {}) {
	return {
		authDisabled,
		authConfig: { groups: { applicationAccess: 'app-group-id', admin } },
		logger: mockLogger()
	} as never;
}

/** A session signed in as a member of `groups` - as core's auth keeps the account. */
function sessionIn(...groups: string[]) {
	return { account: { idTokenClaims: { groups } } } as never;
}

describe('admin access', () => {
	it("lets in only its group's members once the group is set", () => {
		assert.strictEqual(canUseAdmin(service(), sessionIn('app-group-id', ADMIN_GROUP)), true);
		assert.strictEqual(canUseAdmin(service(), sessionIn('app-group-id')), false);
		// no groups claim, or no account at all
		assert.strictEqual(canUseAdmin(service(), { account: { idTokenClaims: {} } } as never), false);
		assert.strictEqual(canUseAdmin(service(), {} as never), false);
	});

	it('lets everyone in with no admin group set, and with sign-in off', () => {
		assert.strictEqual(canUseAdmin(service({ admin: '' }), sessionIn('app-group-id')), true);
		assert.strictEqual(canUseAdmin(service({ authDisabled: true }), {} as never), true);
	});

	it('refuses the admin section with the 403 page, and logs it', () => {
		const svc = service() as unknown as { logger: { warn: { mock: { callCount(): number } } } };
		const guard = buildAssertAdminAccess(svc as never);
		const res = { status: mock.fn(() => res), render: mock.fn() };
		const next = mock.fn();
		guard({ session: sessionIn('app-group-id'), originalUrl: '/admin/database' } as never, res as never, next);
		assert.strictEqual(next.mock.callCount(), 0);
		assert.deepStrictEqual(res.status.mock.calls[0].arguments, [403]);
		assert.deepStrictEqual(res.render.mock.calls[0].arguments, ['views/errors/403.njk']);
		assert.strictEqual(svc.logger.warn.mock.callCount(), 1);

		guard({ session: sessionIn(ADMIN_GROUP), originalUrl: '/admin' } as never, res as never, next);
		assert.strictEqual(next.mock.callCount(), 1);
	});
});
