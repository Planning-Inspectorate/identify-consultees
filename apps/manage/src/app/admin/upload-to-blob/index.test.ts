import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { createManageTestService } from '../../testing/create-test-app.ts';
import { createRoutes, UPLOAD_TMP_DIR } from './index.ts';

describe('upload-to-blob routes', () => {
	test('createRoutes sweeps files a previous process left in the upload tmp dir', async () => {
		const service = createManageTestService();
		const leftover = join(UPLOAD_TMP_DIR, 'crashed-upload-part');
		writeFileSync(leftover, 'never cleaned up');
		try {
			createRoutes(service);
			assert.equal(existsSync(leftover), false);
		} finally {
			await service.db.$disconnect().catch(() => undefined);
		}
	});
});
