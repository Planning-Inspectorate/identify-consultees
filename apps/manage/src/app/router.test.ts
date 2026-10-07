import { ManageService } from '#service';
import { loadCaseBoundaries } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import request from 'supertest';
import { buildAuthRateLimiter } from './router.ts';
import { buildManageTestConfig, createManageTestApp, createManageTestService } from './testing/create-test-app.ts';

// a fixed id, rather than depending on whatever sample data may or may not be seeded (CI's
// database is migrated but never seeded - see .azure/pipelines/pr.yml)
const homePageTestCaseId = '33333333-3333-3333-3333-333333333333';

describe('manage router wiring', () => {
	const authDisabledService = createManageTestService(true);
	const authDisabledApp = createManageTestApp(authDisabledService);

	before(async () => {
		await authDisabledService.db.$executeRaw`DELETE FROM case_boundary WHERE id = ${homePageTestCaseId}`;
		await loadCaseBoundaries(authDisabledService.db, {
			type: 'FeatureCollection',
			features: [
				{
					id: homePageTestCaseId,
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [-1.5, 52.5] },
					properties: { caseReference: 'ZZ000001', caseName: 'Router Test Fixture Wind Farm' }
				}
			]
		});
	});

	after(async () => {
		await authDisabledService.db.$executeRaw`DELETE FROM case_boundary WHERE id = ${homePageTestCaseId}`;
		await authDisabledService.db.$disconnect().catch(() => undefined);
	});

	test('GET / renders the identify consultees home page', async () => {
		const response = await request(authDisabledApp).get('/?q=Router+Test+Fixture');
		assert.equal(response.status, 200);
		assert.match(response.text, /Identify consultees for a NSIP project/);
		assert.match(response.text, /Router Test Fixture Wind Farm/);
		assert.match(response.text, new RegExp(`/consultees/${homePageTestCaseId}`));
	});

	test('GET /signed-out renders the signed out page', async () => {
		const response = await request(authDisabledApp).get('/signed-out');
		assert.equal(response.status, 200);
		assert.match(response.text, /You have signed out/);
		assert.match(response.text, /Sign in again/);
		assert.match(response.text, /href="\/"/);
	});

	test('GET /signed-out links to /auth/signin when auth is enabled', async () => {
		const service = createManageTestService(false);
		const app = createManageTestApp(service);
		try {
			const response = await request(app).get('/signed-out');
			assert.equal(response.status, 200);
			assert.match(response.text, /href="\/auth\/signin"/);
		} finally {
			await service.db.$disconnect().catch(() => undefined);
		}
	});

	test('GET /auth/signout redirects to /signed-out when auth is disabled', async () => {
		const response = await request(authDisabledApp).get('/auth/signout');
		assert.equal(response.status, 302);
		assert.equal(response.headers.location, '/signed-out');
	});

	test('the footer lists the support links on every page', async () => {
		const response = await request(authDisabledApp).get('/');
		assert.equal(response.status, 200);
		for (const [text, href] of [
			['Terms and conditions', '/terms-and-conditions'],
			['Accessibility statement', '/accessibility-statement'],
			['Privacy', '/privacy'],
			['Cookies', '/cookies'],
			['Contact', '/contact']
		]) {
			assert.match(response.text, new RegExp(`href="${href}"[^>]*>\\s*${text}`));
		}
	});

	for (const [path, expected] of [
		['/terms-and-conditions', /Terms and conditions/],
		['/accessibility-statement', /Accessibility statement for Identify consultees/],
		['/privacy', /Privacy notice/],
		['/cookies', /Cookies/],
		['/contact', /Contact us/]
	] as const) {
		test(`GET ${path} renders its footer page`, async () => {
			const response = await request(authDisabledApp).get(path);
			assert.equal(response.status, 200);
			assert.match(response.text, expected);
		});
	}

	test('GET /?pageSize=50 honours the requested page size', async () => {
		const response = await request(authDisabledApp).get('/?q=Router+Test+Fixture&pageSize=50');
		assert.equal(response.status, 200);
		assert.match(response.text, /Showing 1 to 1 of 1 results/);
		assert.match(response.text, />50</);
	});

	test('GET /consultees/:id renders the project map page', async () => {
		const response = await request(authDisabledApp).get(`/consultees/${homePageTestCaseId}`);
		assert.equal(response.status, 200);
		assert.match(response.text, /Router Test Fixture Wind Farm/);
		assert.match(response.text, /Back to projects/);
		assert.match(response.text, /Shapefile/);
		assert.match(response.text, /Example ruleset/);
		assert.match(response.text, /Preview report/);
		assert.match(response.text, /Run Intersection logic/);
		assert.match(response.text, /app-consultee-map/);
	});

	test('GET /consultees/:id/ruleset renders the ruleset radios', async () => {
		const response = await request(authDisabledApp).get(`/consultees/${homePageTestCaseId}/ruleset`);
		assert.equal(response.status, 200);
		assert.match(response.text, /<h1[^>]*>\s*Ruleset|Ruleset\s*<\/h1>/);
		assert.match(response.text, /type="radio"[^>]*value="example-ruleset"/);
		assert.match(response.text, /Save and return/);
	});

	test('GET /consultees/:id/shapefile renders the file radios', async () => {
		const response = await request(authDisabledApp).get(`/consultees/${homePageTestCaseId}/shapefile`);
		assert.equal(response.status, 200);
		assert.match(response.text, /Project shapefile/);
		assert.match(response.text, /type="radio"[^>]*value="33333333-3333-3333-3333-333333333333"/);
		assert.match(response.text, /Save and return/);
	});

	test('POST /consultees/:id/ruleset redirects back to the map page with the chosen ruleset', async () => {
		const agent = request.agent(authDisabledApp);
		const page = await agent.get(`/consultees/${homePageTestCaseId}/ruleset`);
		const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
		assert.ok(csrf, 'expected the ruleset form to carry a CSRF token');

		const response = await agent
			.post(`/consultees/${homePageTestCaseId}/ruleset`)
			.type('form')
			.send({ _csrf: csrf, ruleset: 'example-ruleset' });
		assert.equal(response.status, 302);
		assert.equal(response.headers.location, `/consultees/${homePageTestCaseId}?ruleset=example-ruleset`);
	});

	test('POST /consultees/:id/shapefile redirects to the chosen boundary’s map page', async () => {
		const agent = request.agent(authDisabledApp);
		const page = await agent.get(`/consultees/${homePageTestCaseId}/shapefile`);
		const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
		assert.ok(csrf, 'expected the shapefile form to carry a CSRF token');

		const response = await agent
			.post(`/consultees/${homePageTestCaseId}/shapefile`)
			.type('form')
			.send({ _csrf: csrf, shapefile: homePageTestCaseId, ruleset: 'example-ruleset' });
		assert.equal(response.status, 302);
		assert.equal(response.headers.location, `/consultees/${homePageTestCaseId}?ruleset=example-ruleset`);
	});

	test('POST /consultees/:id/run-intersection redirects back to the map page', async () => {
		const agent = request.agent(authDisabledApp);
		const page = await agent.get(`/consultees/${homePageTestCaseId}?ruleset=example-ruleset`);
		const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
		assert.ok(csrf, 'expected the run-intersection form to carry a CSRF token');

		const response = await agent
			.post(`/consultees/${homePageTestCaseId}/run-intersection`)
			.type('form')
			.send({ _csrf: csrf, ruleset: 'example-ruleset' });
		assert.equal(response.status, 302);
		assert.equal(response.headers.location, `/consultees/${homePageTestCaseId}?ruleset=example-ruleset`);
	});

	test('GET /consultees/:id/report renders the report check page', async () => {
		const response = await request(authDisabledApp).get(
			`/consultees/${homePageTestCaseId}/report?ruleset=example-ruleset`
		);
		assert.equal(response.status, 200);
		assert.match(response.text, /Check consultees before creating the report/);
		assert.match(response.text, /Report details/);
		assert.match(response.text, /Identified consultees/);
		assert.match(response.text, /Generate report/);
	});

	test('GET /consultees/:id/report/consultees renders a category’s change page', async () => {
		const response = await request(authDisabledApp).get(
			`/consultees/${homePageTestCaseId}/report/consultees?ruleset=example-ruleset&category=Parish%20Council`
		);
		assert.equal(response.status, 200);
		assert.match(response.text, /Parish Council/);
		assert.match(response.text, /Save and return/);
	});

	test('GET /consultees/:id/report/consultees 404s for a category the ruleset doesn’t cover', async () => {
		const response = await request(authDisabledApp).get(
			`/consultees/${homePageTestCaseId}/report/consultees?ruleset=example-ruleset&category=Not%20A%20Category`
		);
		assert.equal(response.status, 404);
	});

	test('GET /consultees/:id/report/consultees/add renders the select-a-consultee form', async () => {
		const response = await request(authDisabledApp).get(
			`/consultees/${homePageTestCaseId}/report/consultees/add?ruleset=example-ruleset&category=Parish%20Council`
		);
		assert.equal(response.status, 200);
		assert.match(response.text, /Select a consultee/);
		assert.match(response.text, /Name of consultee/);
		assert.match(response.text, /Reason for identification/);
	});

	test('POST /consultees/:id/report/consultees/add adds the consultee and lists it on the category page', async () => {
		const agent = request.agent(authDisabledApp);
		const page = await agent.get(
			`/consultees/${homePageTestCaseId}/report/consultees/add?ruleset=example-ruleset&category=Parish%20Council`
		);
		const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
		assert.ok(csrf, 'expected the add form to carry a CSRF token');

		const response = await agent
			.post(`/consultees/${homePageTestCaseId}/report/consultees/add?ruleset=example-ruleset&category=Parish%20Council`)
			.type('form')
			.send({ _csrf: csrf, name: 'Router Test Consultee', reason: 'Adjacent landowner' });
		assert.equal(response.status, 302);
		const location = response.headers.location;
		assert.match(location, /\/report\/consultees\?ruleset=example-ruleset&category=Parish%20Council&add=/);

		const categoryPage = await agent.get(location);
		assert.equal(categoryPage.status, 200);
		assert.match(categoryPage.text, /Router Test Consultee/);
		assert.match(categoryPage.text, /Adjacent landowner/);
	});

	test('POST /consultees/:id/report/consultees/add re-renders with an error when the name is blank', async () => {
		const agent = request.agent(authDisabledApp);
		const page = await agent.get(
			`/consultees/${homePageTestCaseId}/report/consultees/add?ruleset=example-ruleset&category=Parish%20Council`
		);
		const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
		assert.ok(csrf, 'expected the add form to carry a CSRF token');

		const response = await agent
			.post(`/consultees/${homePageTestCaseId}/report/consultees/add?ruleset=example-ruleset&category=Parish%20Council`)
			.type('form')
			.send({ _csrf: csrf, name: '', reason: 'no name' });
		assert.equal(response.status, 200);
		assert.match(response.text, /There is a problem/);
		assert.match(response.text, /Enter the consultee name/);
	});

	test('GET /consultees/:id/report/created renders the report created page', async () => {
		const response = await request(authDisabledApp).get(
			`/consultees/${homePageTestCaseId}/report/created?ruleset=example-ruleset`
		);
		assert.equal(response.status, 200);
		assert.match(response.text, /Report created/);
		assert.match(response.text, /Download Router Test Fixture Wind Farm scoping report/);
	});

	test('GET /consultees/:id/results runs the ruleset and renders the results page', async () => {
		const response = await request(authDisabledApp).get(
			`/consultees/${homePageTestCaseId}/results?ruleset=example-ruleset`
		);
		assert.equal(response.status, 200);
		assert.match(response.text, /Consultees identified for/);
		assert.match(response.text, /Ruleset used: Example ruleset/);
	});

	test('GET /consultees/:id/results 404s for an unknown ruleset', async () => {
		const response = await request(authDisabledApp).get(
			`/consultees/${homePageTestCaseId}/results?ruleset=not-a-real-ruleset`
		);
		assert.equal(response.status, 404);
	});

	test('GET /consultees/:id 404s for an unknown case', async () => {
		const response = await request(authDisabledApp).get('/consultees/99999999-9999-9999-9999-999999999999');
		assert.equal(response.status, 404);
	});

	test('GET /auth/signout renders a sanitised 500 when session destroy fails', async () => {
		const express = (await import('express')).default;
		const service = createManageTestService(true);
		service.logger = (await import('@planning-inspectorate/core/testing')).mockLogger();
		const { buildRouter } = await import('./router.ts');
		const { configureNunjucks } = await import('./nunjucks.ts');
		const app = express();
		configureNunjucks().express(app);
		app.set('view engine', 'njk');
		app.use((req, _res, next) => {
			req.session = {
				destroy(callback) {
					callback(new Error('destroy failed: internal detail that must not leak'));
				}
			};
			next();
		});
		app.use(buildRouter(service));

		try {
			const response = await request(app).get('/auth/signout');
			assert.equal(response.status, 500);
			assert.match(response.text, /Sorry, there is a problem with the service/);
			assert.doesNotMatch(response.text, /internal detail that must not leak/);
		} finally {
			await service.db.$disconnect().catch(() => undefined);
		}
	});

	test('GET /map-layers-demo renders the layer toggles prototype', async () => {
		const response = await request(authDisabledApp).get('/map-layers-demo');
		assert.equal(response.status, 200);
		assert.match(response.text, /Map layers demo/);
		assert.match(response.text, /Railway lines/);
		assert.match(response.text, /Road network/);
		assert.match(response.text, /Flood risk area/);
		assert.match(response.text, /map-layers-demo(?:-[0-9a-f]{8})?\.js/);
		assert.match(response.text, /app-map-layers-demo/);
	});

	test('GET /admin/upload-to-blob renders the upload form', async () => {
		const response = await request(authDisabledApp).get('/admin/upload-to-blob');
		assert.equal(response.status, 200);
		assert.match(response.text, /Upload a file to blob storage/);
	});

	test('POST /admin/upload-to-blob/run accepts a multipart file and reports blob storage is not configured', async () => {
		// proves multer (applied in views/admin-upload-to-blob/index.ts) actually parses a real
		// multipart body end-to-end; the test service has no blobStore configured (see
		// buildManageTestConfig), so this also exercises that guard rather than a real Azure call -
		// the successful-upload path is covered by controller.test.ts with an injected uploader
		const response = await request(authDisabledApp)
			.post('/admin/upload-to-blob/run')
			.attach('file', Buffer.from('{}'), 'test.geojson');
		assert.equal(response.status, 200);
		assert.match(response.text, /not configured/);
	});

	test('GET /components lists every GOV.UK Frontend component', async () => {
		const response = await request(authDisabledApp).get('/components');
		assert.equal(response.status, 200);
		assert.match(response.text, /GOV.UK Frontend components/);
		assert.match(response.text, /href="\/components\/button"/);
		assert.match(response.text, /href="\/components\/warning-text"/);
	});

	test('GET /components/:component renders the fixture examples', async () => {
		const response = await request(authDisabledApp).get('/components/tag');
		assert.equal(response.status, 200);
		assert.match(response.text, /<h1 class="govuk-heading-xl">\s*Tag/);
		assert.match(response.text, /govuk-tag/);
		assert.match(response.text, /pins-component-example/);
	});

	test('GET /components/:component 404s for an unknown component', async () => {
		const response = await request(authDisabledApp).get('/components/not-a-component');
		assert.equal(response.status, 404);
	});

	test('GET /components/interactive-map lists the Defra map examples', async () => {
		const response = await request(authDisabledApp).get('/components/interactive-map');
		assert.equal(response.status, 200);
		assert.match(response.text, /Interactive map/);
		assert.match(response.text, /href="\/components\/interactive-map\/basic"/);
		assert.match(response.text, /href="\/components\/interactive-map\/style-switcher"/);
	});

	test('GET /components/interactive-map/:example renders a map region with a noscript fallback', async () => {
		const response = await request(authDisabledApp).get('/components/interactive-map/polygons');
		assert.equal(response.status, 200);
		assert.match(response.text, /Polygon overlay/);
		assert.match(response.text, /role="region"/);
		assert.match(response.text, /app-interactive-map-example/);
		assert.match(response.text, /<noscript>[\s\S]*src="\/components\/interactive-map\/polygons\/static-map"/);
		// only the plugins this example uses are loaded
		assert.match(response.text, /datasets-plugin\/js\/index(?:-[0-9a-f]{8})?\.js/);
		assert.doesNotMatch(response.text, /draw-plugin\/js\/index/);
	});

	test('GET /components/interactive-map/select-feature renders the numbered feature legend', async () => {
		const response = await request(authDisabledApp).get('/components/interactive-map/select-feature');
		assert.equal(response.status, 200);
		assert.match(response.text, /Parcels shown on the map/);
		// once inside noscript (JS disabled) and once in the hidden block the
		// client reveals on init failure
		assert.match(response.text, /<noscript>[\s\S]*Permanent grassland/);
		assert.match(response.text, /id="interactive-map-example-select-feature-fallback"[^>]*hidden/);
		assert.match(response.text, /Land use/);
	});

	test('GET /components/interactive-map/button-first collapses the fixed-height map box', async () => {
		const response = await request(authDisabledApp).get('/components/interactive-map/button-first');
		assert.equal(response.status, 200);
		assert.match(response.text, /app-case-map app-interactive-map-example app-case-map--button-first/);
		// interaction instructions are JS-only — hidden when JavaScript is off
		assert.match(response.text, /<noscript><style>\.app-js-only \{ display: none; \}<\/style><\/noscript>/);
		assert.match(response.text, /govuk-inset-text app-js-only/);
	});

	test('GET /components/interactive-map/:example keeps the fixed-height box for inline maps', async () => {
		const response = await request(authDisabledApp).get('/components/interactive-map/basic');
		assert.equal(response.status, 200);
		assert.match(response.text, /class="app-case-map app-interactive-map-example"/);
		assert.doesNotMatch(response.text, /app-case-map--button-first/);
	});

	test('GET /components/interactive-map/:example 404s for an unknown example', async () => {
		const response = await request(authDisabledApp).get('/components/interactive-map/not-an-example');
		assert.equal(response.status, 404);
	});

	test('GET /vendor webpack lazy chunks revalidate rather than cache under a stable name', async () => {
		// im-core.js keeps its name across package versions; a stale copy crashing against
		// a new fingerprinted entry was the "o[e] is not a function" map outage. The br
		// variant is the path browsers take - plain requests get no-store upstream.
		const chunk = '/vendor/interactive-map/js/im-core.js';
		const br = { 'Accept-Encoding': 'br' };
		const response = await request(authDisabledApp).get(chunk).set(br);
		assert.equal(response.status, 200);
		assert.equal(response.headers['content-encoding'], 'br');
		assert.match(response.headers['cache-control'] || '', /max-age=0/);
		assert.ok(response.headers.etag);

		const revalidated = await request(authDisabledApp)
			.get(chunk)
			.set({ ...br, 'If-None-Match': response.headers.etag });
		assert.equal(revalidated.status, 304);
	});

	test('GET /components/interactive-map/:example/static-map negotiates and caches the image', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			new Response(
				Buffer.from(
					'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
					'base64'
				),
				{ status: 200, headers: { 'content-type': 'image/png' } }
			);

		try {
			const webp = await request(authDisabledApp)
				.get('/components/interactive-map/basic/static-map')
				.set('Accept', 'image/webp');
			assert.equal(webp.status, 200);
			assert.match(webp.headers['content-type'] || '', /image\/webp/);
			assert.equal(webp.headers.vary, 'Accept');
			assert.match(webp.headers['cache-control'] || '', /max-age=/);
			assert.ok(webp.headers.etag);

			const cached = await request(authDisabledApp)
				.get('/components/interactive-map/basic/static-map')
				.set('Accept', 'image/webp')
				.set('If-None-Match', webp.headers.etag);
			assert.equal(cached.status, 304);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('the Components nav link only renders with ?components=true', async () => {
		const withoutFlag = await request(authDisabledApp).get('/components');
		assert.doesNotMatch(withoutFlag.text, />\s*Components\s*<\/a>/);
		assert.doesNotMatch(withoutFlag.text, /href="\/components\/button\?components=true"/);

		const withFlag = await request(authDisabledApp).get('/components?components=true');
		assert.match(
			withFlag.text,
			/govuk-service-navigation__link" href="\/components\?components=true">\s*Components\s*<\/a>/
		);
		assert.match(withFlag.text, /href="\/components\/button\?components=true"/);
	});

	test('GET /consultees/:id/results/static-map returns a cached image', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			new Response(
				Buffer.from(
					'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
					'base64'
				),
				{
					status: 200,
					headers: { 'content-type': 'image/png' }
				}
			);

		try {
			const response = await request(authDisabledApp).get(
				`/consultees/${homePageTestCaseId}/results/static-map?ruleset=example-ruleset`
			);
			assert.equal(response.status, 200);
			assert.match(response.headers['content-type'] || '', /image\/(svg\+xml|png)/);
			assert.match(response.headers['cache-control'] || '', /max-age=/);
			assert.ok(response.headers.etag);

			const cached = await request(authDisabledApp)
				.get(`/consultees/${homePageTestCaseId}/results/static-map?ruleset=example-ruleset`)
				.set('If-None-Match', response.headers.etag);
			assert.equal(cached.status, 304);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('GET /consultees/:id/results/static-map.svg returns svg', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			new Response(
				Buffer.from(
					'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
					'base64'
				),
				{
					status: 200,
					headers: { 'content-type': 'image/png' }
				}
			);

		try {
			const response = await request(authDisabledApp).get(
				`/consultees/${homePageTestCaseId}/results/static-map.svg?ruleset=example-ruleset`
			);
			assert.equal(response.status, 200);
			assert.match(response.headers['content-type'] || '', /image\/svg\+xml/);
			assert.match(response.body.toString(), /<svg/);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('GET /unauthenticated returns 401', async () => {
		const response = await request(authDisabledApp).get('/unauthenticated');
		assert.equal(response.status, 401);
		assert.match(response.text, /Sorry, there is a problem with your login/);
	});

	test('GET /error/firewall-error renders the firewall error page', async () => {
		const response = await request(authDisabledApp).get('/error/firewall-error');
		assert.equal(response.status, 200);
		assert.match(response.text, /Sorry, there is a problem with the service/);
	});

	test('GET /auth is rate limited when auth is enabled', async () => {
		const service = new ManageService(buildManageTestConfig(false));
		const app = createManageTestApp(service, {
			authRateLimiter: buildAuthRateLimiter({ limit: 2, windowMs: 60_000 })
		});

		try {
			const first = await request(app).get('/auth/signin');
			const second = await request(app).get('/auth/signin');
			const third = await request(app).get('/auth/signin');

			assert.notEqual(first.status, 429);
			assert.notEqual(second.status, 429);
			assert.equal(third.status, 429);
		} finally {
			await service.db.$disconnect().catch(() => undefined);
		}
	});
});
