import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ManageService } from './service.ts';
import { buildManageTestConfig } from './testing/create-test-app.ts';

describe('ManageService', () => {
	test('exposes auth, python function, and static asset accessors', async () => {
		const config = buildManageTestConfig(true);
		const service = new ManageService(config);
		try {
			assert.equal(service.authDisabled, true);
			assert.equal(service.authConfig.clientId, 'client-id');
			assert.equal(service.pythonFunctionUrl, config.pythonFunctionUrl);
			assert.equal(service.assetsStaticDir, config.staticDir);
			assert.match(service.staticDir, /\.core-static-noop$/);
		} finally {
			await service.db.$disconnect().catch(() => undefined);
		}
	});
});
