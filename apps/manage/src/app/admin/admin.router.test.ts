import { loadCaseBoundaries } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import { loadConsulteeAreas } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import request from 'supertest';
import { createManageTestApp, createManageTestService } from '../testing/create-test-app.ts';

// fixed ids, so the tests can find their own rows in a shared local database
const consulteeAreaId = '44444444-0000-0000-0000-00000000ad01';
const caseBoundaryId = '44444444-0000-0000-0000-00000000ad02';

describe('admin section', () => {
	const service = createManageTestService(true);
	const app = createManageTestApp(service);

	const cleanup = async () => {
		await service.db.$executeRaw`DELETE FROM consultee_area WHERE id = ${consulteeAreaId}`;
		await service.db.$executeRaw`DELETE FROM case_boundary WHERE id = ${caseBoundaryId}`;
	};

	before(async () => {
		await cleanup();
		await loadConsulteeAreas(service.db, {
			type: 'FeatureCollection',
			features: [
				{
					id: consulteeAreaId,
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [1.5, 55.5] },
					properties: {
						consulteeCategory: 'Parish Council',
						consultee: 'Admin Test Parish',
						metadata: { FID: 612 }
					}
				}
			]
		});
		await loadCaseBoundaries(service.db, {
			type: 'FeatureCollection',
			features: [
				{
					id: caseBoundaryId,
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [1.5, 55.5] },
					properties: { caseReference: 'ZZADMIN01', caseName: 'Admin Test Case' }
				}
			]
		});
	});

	after(async () => {
		await cleanup();
		await service.db.$disconnect().catch(() => undefined);
	});

	test('GET /admin lists the admin pages, with the menu and the header link marked', async () => {
		const response = await request(app).get('/admin');
		assert.equal(response.status, 200);
		assert.match(response.text, /<h1 class="govuk-heading-l">Admin<\/h1>/);
		assert.match(response.text, /href="\/admin" aria-current="page">Overview<\/a>/);
		assert.match(response.text, /<a class="govuk-service-navigation__link" href="\/admin" aria-current="true">/);
		for (const page of [
			'/admin/database',
			'/admin/upload-to-blob',
			'/admin/import-reference-data',
			'/admin/cbos-connection',
			'/admin/import-from-cbos'
		]) {
			assert.match(response.text, new RegExp(`<h2[^>]*><a class="govuk-link" href="${page}">`));
		}
	});

	test('the header links to the admin section from any page, without marking it there', async () => {
		const response = await request(app).get('/');
		assert.match(response.text, /<a class="govuk-service-navigation__link" href="\/admin">\s*Admin/);
	});

	test('GET /admin/database counts the tables and the consultee areas by category', async () => {
		const response = await request(app).get('/admin/database');
		assert.equal(response.status, 200);
		assert.match(response.text, /href="\/admin\/database" aria-current="page">Database<\/a>/);
		assert.match(response.text, /<code>consultee_area<\/code>/);
		assert.match(response.text, /<code>case_boundary<\/code>/);
		assert.match(
			response.text,
			/href="\/admin\/database\/consultee-areas\?category=Parish\+Council">Parish Council<\/a>/
		);
	});

	test('the consultee areas list finds a row by name, and its page shows it whole', async () => {
		const list = await request(app).get('/admin/database/consultee-areas?category=Parish+Council&q=Admin+Test');
		assert.equal(list.status, 200);
		assert.match(list.text, /Showing 1 to 1 of 1 rows\./);
		assert.match(
			list.text,
			new RegExp(`href="/admin/database/consultee-areas/${consulteeAreaId}">Admin Test Parish</a>`)
		);

		const row = await request(app).get(`/admin/database/consultee-areas/${consulteeAreaId}`);
		assert.equal(row.status, 200);
		assert.match(row.text, /Admin Test Parish/);
		assert.match(row.text, /&quot;FID&quot;: 612/);
		// geometries aren't shown
		assert.doesNotMatch(row.text, /geometrySimplified/);
	});

	test('the case boundaries list finds a row by reference, and its page shows it whole', async () => {
		const list = await request(app).get('/admin/database/case-boundaries?q=ZZADMIN01');
		assert.equal(list.status, 200);
		assert.match(list.text, new RegExp(`href="/admin/database/case-boundaries/${caseBoundaryId}">ZZADMIN01</a>`));

		const row = await request(app).get(`/admin/database/case-boundaries/${caseBoundaryId}`);
		assert.equal(row.status, 200);
		assert.match(row.text, /ZZADMIN01 Admin Test Case/);
	});

	test('a row that is not there is a 404', async () => {
		assert.equal((await request(app).get('/admin/database/consultee-areas/not-an-id')).status, 404);
		assert.equal(
			(await request(app).get('/admin/database/case-boundaries/44444444-0000-0000-0000-000000000000')).status,
			404
		);
	});

	test('GET /admin/upload-to-blob renders the upload form in the admin layout', async () => {
		const response = await request(app).get('/admin/upload-to-blob');
		assert.equal(response.status, 200);
		assert.match(response.text, /Upload a file to blob storage/);
		assert.match(response.text, /aria-current="page">Upload to blob storage<\/a>/);
	});

	test('POST /admin/upload-to-blob/run accepts a multipart file and reports blob storage is not configured', async () => {
		// proves multer (applied in upload-to-blob/index.ts) actually parses a real multipart body
		// end-to-end - ADMIN_MULTIPART_ROUTES lets it past the CSRF check first. The test service has
		// no blobStore configured (see buildManageTestConfig), so this also exercises that guard
		// rather than a real Azure call - the successful-upload path is covered by controller.test.ts
		const response = await request(app)
			.post('/admin/upload-to-blob/run')
			.attach('file', Buffer.from('{}'), 'test.geojson');
		assert.equal(response.status, 200);
		assert.match(response.text, /not configured/);
	});
});
