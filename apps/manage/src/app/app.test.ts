import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { createApp, prepareStaticAssetServing } from './app.ts';
import { createManageTestService } from './testing/create-test-app.ts';

describe('createApp', () => {
	/** @type {string | undefined} */
	let tempMount;

	after(async () => {
		if (tempMount) {
			await rm(tempMount, { recursive: true, force: true });
		}
	});

	test('prepareStaticAssetServing creates the core noop static mount', async () => {
		const service = createManageTestService(true);
		try {
			await prepareStaticAssetServing(service);
			const mountStats = await stat(service.staticDir);
			assert.equal(mountStats.isDirectory(), true);
			tempMount = service.staticDir;
		} finally {
			await service.db.$disconnect().catch(() => undefined);
		}
	});

	test('createApp returns an Express application', async () => {
		tempMount = await mkdtemp(path.join(tmpdir(), 'manage-app-'));
		const service = createManageTestService(true);
		try {
			const app = createApp(service);
			assert.equal(typeof app.listen, 'function');
			assert.equal(typeof app.use, 'function');
		} finally {
			await service.db.$disconnect().catch(() => undefined);
		}
	});
});
