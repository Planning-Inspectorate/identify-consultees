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
			assert.equal(service.pythonFunctionApiKey, config.pythonFunctionApiKey);
			assert.equal(service.blobStoreConfig, config.blobStore);
			assert.equal(service.nearbyConsulteeRadiusMetres, config.nearbyConsulteeRadiusMetres);
			assert.equal(service.nearbyNsipRadiusMetres, config.nearbyNsipRadiusMetres);
			// with no per-category distances, the search reaches the default
			assert.equal(service.nearbySearchRadiusMetres, config.nearbyConsulteeRadiusMetres);
			assert.equal(service.assetsStaticDir, config.staticDir);
			assert.match(service.staticDir, /\.core-static-noop$/);
		} finally {
			await service.db.$disconnect().catch(() => undefined);
		}
	});

	test('searches out to the largest nearby distance, default or per category', async () => {
		const service = new ManageService({
			...buildManageTestConfig(true),
			nearbyConsulteeRadiusMetres: 20_000,
			nearbyRadiusMetresByCategory: { Hospital: 35_000, 'Parish Council': 5_000 }
		});
		try {
			assert.equal(service.nearbySearchRadiusMetres, 35_000);
		} finally {
			await service.db.$disconnect().catch(() => undefined);
		}
	});

	test('makes one bulk database client, for the admin loads, the first time it is needed', async () => {
		const service = new ManageService(buildManageTestConfig(true));
		try {
			const bulk = service.bulkDb;
			assert.notEqual(bulk, service.db);
			assert.equal(service.bulkDb, bulk);
		} finally {
			await service.bulkDb.$disconnect().catch(() => undefined);
			await service.db.$disconnect().catch(() => undefined);
		}
	});

	test('looks for no Nearby NSIPs unless a distance is set, and searches out to it', async () => {
		const service = new ManageService({ ...buildManageTestConfig(true), nearbyNsipRadiusMetres: undefined });
		const further = new ManageService({ ...buildManageTestConfig(true), nearbyNsipRadiusMetres: 45_000 });
		try {
			assert.equal(service.nearbyNsipRadiusMetres, 0);
			assert.equal(further.nearbySearchRadiusMetres, 45_000);
		} finally {
			await service.db.$disconnect().catch(() => undefined);
			await further.db.$disconnect().catch(() => undefined);
		}
	});
});
