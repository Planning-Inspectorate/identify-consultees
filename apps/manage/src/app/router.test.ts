import { ManageService } from '#service';
import { acquireDbTestLock, releaseDbTestLock } from '@pins/identify-consultees-database/src/db-test-lock.ts';
import { loadCaseBoundaries } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import { loadConsulteeAreas } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import request from 'supertest';
import { buildAuthRateLimiter } from './router.ts';
import { buildManageTestConfig, createManageTestApp, createManageTestService } from './testing/create-test-app.ts';

// a fixed id, rather than depending on whatever sample data may or may not be seeded (CI's
// database is migrated but never seeded - see .azure/pipelines/pr.yml). The site's point must
// stay well away from the fixtures other test files insert into the shared database (test files
// run in parallel): a case_boundary within the nearby-NSIP radius (10km) or a consultee_area
// within the ruleset's reach (~35km) would join the run mid-test and change the static-map etag
// between the two requests below
const homePageTestCaseId = '33333333-3333-3333-3333-333333333333';
// a consultee the add form can add - it only takes names that are consultees in the reference data
const routerTestConsulteeId = '33333333-3333-3333-3333-333333333334';

// footer hrefs are literal strings (including an external URL) - escape them before
// they go into a RegExp, otherwise '.' etc. match more than the literal href
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('manage router wiring', () => {
	const authDisabledService = createManageTestService(true);
	const authDisabledApp = createManageTestApp(authDisabledService);

	before(async () => {
		// this file's pages read the shared tables - take turns with the other suites
		// writing them (see packages/database/src/db-test-lock.ts)
		await acquireDbTestLock();
		await authDisabledService.db.$executeRaw`DELETE FROM case_boundary WHERE id = ${homePageTestCaseId}`;
		await authDisabledService.db.$executeRaw`DELETE FROM consultee_area WHERE id = ${routerTestConsulteeId}`;
		await loadConsulteeAreas(authDisabledService.db, {
			type: 'FeatureCollection',
			features: [
				{
					id: routerTestConsulteeId,
					type: 'Feature',
					// well away from the test case, so it isn't one of its nearby consultees
					geometry: { type: 'Point', coordinates: [1.5, 55.5] },
					properties: { consulteeCategory: 'Parish, town and community councils', consultee: 'Router Test Consultee' }
				}
			]
		});
		await loadCaseBoundaries(authDisabledService.db, {
			type: 'FeatureCollection',
			features: [
				{
					id: homePageTestCaseId,
					type: 'Feature',
					// mid Wales - hundreds of km from every other suite's fixtures
					geometry: { type: 'Point', coordinates: [-4, 52] },
					properties: { caseReference: 'ZZ000001', caseName: 'Router Test Fixture Wind Farm' }
				}
			]
		});
	});

	after(async () => {
		await authDisabledService.db.$executeRaw`DELETE FROM case_boundary WHERE id = ${homePageTestCaseId}`;
		await authDisabledService.db.$executeRaw`DELETE FROM consultee_area WHERE id = ${routerTestConsulteeId}`;
		releaseDbTestLock();
		await authDisabledService.db.$disconnect().catch(() => undefined);
	});

	test('GET / renders the identify consultees home page', async () => {
		const response = await request(authDisabledApp).get('/?q=Router+Test+Fixture');
		assert.equal(response.status, 200);
		assert.match(response.text, /Identify consultees for a national infrastructure project/);
		assert.match(response.text, /Router Test Fixture Wind Farm/);
		assert.match(response.text, new RegExp(`/consultees/${homePageTestCaseId}`));
	});

	test('GET / flags a blank search as a validation error', async () => {
		const response = await request(authDisabledApp).get('/?q=');
		assert.equal(response.status, 200);
		assert.match(response.text, /govuk-error-summary/);
		assert.match(response.text, /Enter a search term/);
		assert.match(response.text, /<title>\s*Error: /);
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
		// Help and Contact stay routed but are deliberately left out of the footer until
		// their content has had a proper audit
		const footer = response.text.slice(response.text.indexOf('<footer'));
		assert.doesNotMatch(footer, /href="\/help"/);
		assert.doesNotMatch(footer, /href="\/contact"/);
		// the accessibility statement stays routed but its link is hidden (CSS)
		// until its content has had a proper audit
		assert.match(
			footer,
			new RegExp(
				`govuk-footer__inline-list-item pins-footer__item--hidden">\\s*<a[^>]*href="${escapeRegExp('/accessibility-statement')}"`
			)
		);
		assert.equal(footer.match(/pins-footer__item--hidden/g)?.length, 1);
		for (const [text, href] of [
			['Terms and conditions', '/terms-and-conditions'],
			['Accessibility statement', '/accessibility-statement'],
			[
				'Privacy',
				'https://www.gov.uk/government/publications/planning-inspectorate-privacy-notices/customer-privacy-notice'
			],
			['Cookies', '/cookies']
		]) {
			assert.match(response.text, new RegExp(`href="${escapeRegExp(href)}"[^>]*>\\s*${escapeRegExp(text)}`));
		}
	});

	for (const [path, expected] of [
		['/terms-and-conditions', /Terms and conditions/],
		['/accessibility-statement', /Accessibility statement for Identify consultees/],
		['/cookies', /Cookies/],
		['/contact', /Contact us/]
	] as const) {
		test(`GET ${path} renders its footer page`, async () => {
			const response = await request(authDisabledApp).get(path);
			assert.equal(response.status, 200);
			assert.match(response.text, expected);
		});
	}

	test('GET /help renders the user guide, listing the accepted consultee type wordings', async () => {
		const response = await request(authDisabledApp).get('/help');
		assert.equal(response.status, 200);
		assert.match(response.text, /How to use Identify consultees/);
		assert.match(response.text, /Formatting a ruleset change/);
		assert.match(response.text, /<li>Ambulance Trusts<\/li>/);
		// every wording has data today, so no "have no map data yet" note (see views/help/index.test.ts)
		assert.match(response.text, /<li>Cheshire Brine Area<\/li>/);
		assert.doesNotMatch(response.text, /have no map data yet/);
		assert.match(response.text, /role="img"/);
	});

	test('GET /?pageSize=50 honours the requested page size', async () => {
		const response = await request(authDisabledApp).get('/?q=Router+Test+Fixture&pageSize=50');
		assert.equal(response.status, 200);
		assert.match(response.text, /Showing 1 to 1 of 1 results/);
	});

	test('GET /consultees/:id renders the project boundary page', async () => {
		const response = await request(authDisabledApp).get(`/consultees/${homePageTestCaseId}`);
		assert.equal(response.status, 200);
		assert.match(response.text, /Project boundary/);
		assert.match(response.text, /Router Test Fixture Wind Farm/);
		assert.match(response.text, />Back</);
		assert.match(response.text, /Confirm shapefile for report/);
		assert.match(response.text, /Continue/);
		assert.match(response.text, /app-consultee-map/);
		// the single stored file, and nothing else - and no radio pre-selected
		assert.match(response.text, /type="radio"[^>]*value="33333333-3333-3333-3333-333333333333"/);
		assert.doesNotMatch(response.text, /type="radio"[^>]*checked/);
		assert.doesNotMatch(response.text, /:placeholder/);
	});

	test('GET /consultees/:id/ruleset renders the ruleset radios, none pre-selected', async () => {
		const response = await request(authDisabledApp).get(`/consultees/${homePageTestCaseId}/ruleset`);
		assert.equal(response.status, 200);
		// the fieldset legend is the page heading, with the case name as its caption
		assert.match(
			response.text,
			/<legend[^>]*>\s*<h1[^>]*>\s*<span class="govuk-caption-l">[^<]*<\/span>Ruleset\s*<\/h1>\s*<\/legend>/
		);
		assert.match(response.text, /Router Test Fixture Wind Farm/);
		assert.match(response.text, /type="radio"[^>]*value="england-wales-post-20240430"/);
		assert.doesNotMatch(response.text, /type="radio"[^>]*checked/);
		assert.match(response.text, /Identify consultees/);
	});

	test('POST /refresh-cases starts refreshing cases and goes back to the same search', async () => {
		const agent = request.agent(authDisabledApp);
		const page = await agent.get('/?q=EN01');
		const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
		assert.ok(csrf, 'expected the Refresh cases form to carry a CSRF token');

		// no function is configured here, so the import it starts in the background fails at once
		const response = await agent.post('/refresh-cases').type('form').send({ _csrf: csrf, q: 'EN01', pageSize: '25' });
		assert.equal(response.status, 302);
		assert.equal(response.headers.location, '/?q=EN01&pageSize=25&refreshing=1');

		const back = await agent.get(response.headers.location);
		assert.match(back.text, /Refreshing cases from CBOS/);
	});

	test('GET /consultees/:id/ruleset?ruleset= marks only the already-chosen ruleset checked', async () => {
		const response = await request(authDisabledApp).get(
			`/consultees/${homePageTestCaseId}/ruleset?ruleset=england-wales-post-20240430`
		);
		assert.equal(response.status, 200);
		assert.match(response.text, /type="radio"[^>]*value="england-wales-post-20240430"[^>]*checked/);
	});

	test('POST /consultees/:id/ruleset leads on to the check page with the chosen ruleset', async () => {
		const agent = request.agent(authDisabledApp);
		const page = await agent.get(`/consultees/${homePageTestCaseId}/ruleset`);
		const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
		assert.ok(csrf, 'expected the ruleset form to carry a CSRF token');

		const response = await agent
			.post(`/consultees/${homePageTestCaseId}/ruleset`)
			.type('form')
			.send({ _csrf: csrf, ruleset: 'england-wales-post-20240430' });
		assert.equal(response.status, 302);
		assert.equal(
			response.headers.location,
			`/consultees/${homePageTestCaseId}/report?ruleset=england-wales-post-20240430`
		);
	});

	test('POST /consultees/:id leads on to the ruleset page for the chosen shapefile', async () => {
		const agent = request.agent(authDisabledApp);
		const page = await agent.get(`/consultees/${homePageTestCaseId}`);
		const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
		assert.ok(csrf, 'expected the shapefile form to carry a CSRF token');

		const response = await agent
			.post(`/consultees/${homePageTestCaseId}`)
			.type('form')
			.send({ _csrf: csrf, shapefile: homePageTestCaseId });
		assert.equal(response.status, 302);
		assert.equal(response.headers.location, `/consultees/${homePageTestCaseId}/ruleset`);
	});

	test('POST /consultees/:id re-renders with an error when the shapefile is not one of its files', async () => {
		const agent = request.agent(authDisabledApp);
		const page = await agent.get(`/consultees/${homePageTestCaseId}`);
		const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
		assert.ok(csrf, 'expected the shapefile form to carry a CSRF token');

		const response = await agent
			.post(`/consultees/${homePageTestCaseId}`)
			.type('form')
			.send({ _csrf: csrf, shapefile: '99999999-9999-9999-9999-999999999999' });
		assert.equal(response.status, 200);
		assert.match(response.text, /There is a problem/);
		assert.match(response.text, /Select a shapefile/);
	});

	test('POST /consultees/:id/ruleset re-renders with an error when no ruleset is chosen', async () => {
		const agent = request.agent(authDisabledApp);
		const page = await agent.get(`/consultees/${homePageTestCaseId}/ruleset`);
		const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
		assert.ok(csrf, 'expected the ruleset form to carry a CSRF token');

		const response = await agent.post(`/consultees/${homePageTestCaseId}/ruleset`).type('form').send({ _csrf: csrf });
		assert.equal(response.status, 200);
		assert.match(response.text, /There is a problem/);
		assert.match(response.text, /Select a ruleset/);
	});

	test('GET /consultees/:id/report renders the report check page', async () => {
		const response = await request(authDisabledApp).get(
			`/consultees/${homePageTestCaseId}/report?ruleset=england-wales-post-20240430`
		);
		assert.equal(response.status, 200);
		assert.match(response.text, /Check consultees before creating the report/);
		assert.match(response.text, /Report details/);
		assert.match(response.text, /Identified consultees/);
		// the identified consultees sit under the export workbook's group tabs
		assert.match(response.text, /Administrative boundaries/);
		assert.match(response.text, /Public bodies/);
		// a category with no matches says so rather than show a number
		assert.match(response.text, /No consultees/);
		assert.match(response.text, /Create report/);
	});

	test('GET /consultees/:id/report/consultees renders a category’s change page', async () => {
		const response = await request(authDisabledApp).get(
			`/consultees/${homePageTestCaseId}/report/consultees?ruleset=england-wales-post-20240430&category=Parish%2C%20town%20and%20community%20councils`
		);
		assert.equal(response.status, 200);
		assert.match(response.text, /Parish, town and community councils/);
		assert.match(response.text, /Back to draft report/);
		assert.doesNotMatch(response.text, /Save and return/);
	});

	test('GET /consultees/:id/report/consultees 404s for a category the ruleset doesn’t cover', async () => {
		const response = await request(authDisabledApp).get(
			`/consultees/${homePageTestCaseId}/report/consultees?ruleset=england-wales-post-20240430&category=Not%20A%20Category`
		);
		assert.equal(response.status, 404);
	});

	test('GET /consultees/:id/report/consultees links to the add a consultee page', async () => {
		const response = await request(authDisabledApp).get(
			`/consultees/${homePageTestCaseId}/report/consultees?ruleset=england-wales-post-20240430&category=Parish%2C%20town%20and%20community%20councils`
		);
		assert.equal(response.status, 200);
		assert.match(response.text, /href="[^"]*\/report\/consultees\/add\?[^"]*"[^>]*>\s*Add a consultee/);
	});

	test('GET /consultees/:id/report/consultees/add renders the add form, with the autocomplete', async () => {
		const response = await request(authDisabledApp).get(
			`/consultees/${homePageTestCaseId}/report/consultees/add?ruleset=england-wales-post-20240430&category=Parish%2C%20town%20and%20community%20councils`
		);
		assert.equal(response.status, 200);
		assert.match(response.text, /Add a consultee/);
		assert.match(response.text, /<label class="govuk-label govuk-label--m" for="consultee-name">\s*Name\s*<\/label>/);
		assert.match(response.text, /Reason for adding/);
		assert.match(response.text, /<script defer src="\/assets\/js\/accessible-autocomplete\.min[^"]*\.js">/);
		assert.match(response.text, /<script type="module" src="\/javascripts\/consultee-autocomplete[^"]*\.js">/);
	});

	test('POST /consultees/:id/report/consultees/add adds the consultee and lists it on the category page', async () => {
		const agent = request.agent(authDisabledApp);
		const page = await agent.get(
			`/consultees/${homePageTestCaseId}/report/consultees/add?ruleset=england-wales-post-20240430&category=Parish%2C%20town%20and%20community%20councils`
		);
		const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
		assert.ok(csrf, 'expected the add form to carry a CSRF token');

		const response = await agent
			.post(
				`/consultees/${homePageTestCaseId}/report/consultees/add?ruleset=england-wales-post-20240430&category=Parish%2C%20town%20and%20community%20councils`
			)
			.type('form')
			.send({ _csrf: csrf, name: 'Router Test Consultee', reason: 'Adjacent landowner' });
		assert.equal(response.status, 302);
		const location = response.headers.location;
		assert.match(
			location,
			/\/report\/consultees\?ruleset=england-wales-post-20240430&category=Parish%2C%20town%20and%20community%20councils&add=/
		);

		const categoryPage = await agent.get(location);
		assert.equal(categoryPage.status, 200);
		assert.match(categoryPage.text, /Router Test Consultee/);
		assert.match(categoryPage.text, /Adjacent landowner/);
	});

	test('POST /consultees/:id/report/consultees/add refuses a name that is not a consultee', async () => {
		const agent = request.agent(authDisabledApp);
		const addUrl = `/consultees/${homePageTestCaseId}/report/consultees/add?ruleset=england-wales-post-20240430&category=Parish%2C%20town%20and%20community%20councils`;
		const page = await agent.get(addUrl);
		const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];

		const response = await agent
			.post(addUrl)
			.type('form')
			.send({ _csrf: csrf, name: 'Banana', reason: 'Not a consultee' });
		assert.equal(response.status, 200);
		assert.match(response.text, /There is a problem/);
		assert.match(response.text, /Consultee not found/);
	});

	test('POST /consultees/:id/report/consultees/add re-renders with an error when the name is blank', async () => {
		const agent = request.agent(authDisabledApp);
		const page = await agent.get(
			`/consultees/${homePageTestCaseId}/report/consultees/add?ruleset=england-wales-post-20240430&category=Parish%2C%20town%20and%20community%20councils`
		);
		const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
		assert.ok(csrf, 'expected the add form to carry a CSRF token');

		const response = await agent
			.post(
				`/consultees/${homePageTestCaseId}/report/consultees/add?ruleset=england-wales-post-20240430&category=Parish%2C%20town%20and%20community%20councils`
			)
			.type('form')
			.send({ _csrf: csrf, name: '', reason: 'no name' });
		assert.equal(response.status, 200);
		assert.match(response.text, /There is a problem/);
		assert.match(response.text, /Enter the consultee name/);
	});

	test('POST /consultees/:id/report/consultees/add re-renders with an error when the reason is blank', async () => {
		const agent = request.agent(authDisabledApp);
		const page = await agent.get(
			`/consultees/${homePageTestCaseId}/report/consultees/add?ruleset=england-wales-post-20240430&category=Parish%2C%20town%20and%20community%20councils`
		);
		const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
		assert.ok(csrf, 'expected the add form to carry a CSRF token');

		const response = await agent
			.post(
				`/consultees/${homePageTestCaseId}/report/consultees/add?ruleset=england-wales-post-20240430&category=Parish%2C%20town%20and%20community%20councils`
			)
			.type('form')
			.send({ _csrf: csrf, name: 'Router Test Consultee', reason: '' });
		assert.equal(response.status, 200);
		assert.match(response.text, /There is a problem/);
		assert.match(response.text, /Enter a reason for adding this consultee(?!\.)/);
	});

	test('POST /consultees/:id/report/consultees/remove records the reason and lists the removal', async () => {
		const agent = request.agent(authDisabledApp);
		// add a consultee first so there's a hand-added row to remove
		const addPage = await agent.get(
			`/consultees/${homePageTestCaseId}/report/consultees/add?ruleset=england-wales-post-20240430&category=Parish%2C%20town%20and%20community%20councils`
		);
		const addCsrf = /name="_csrf" value="([^"]+)"/.exec(addPage.text)?.[1];
		const added = await agent
			.post(
				`/consultees/${homePageTestCaseId}/report/consultees/add?ruleset=england-wales-post-20240430&category=Parish%2C%20town%20and%20community%20councils`
			)
			.type('form')
			.send({ _csrf: addCsrf, name: 'Router Test Consultee', reason: 'Adjacent landowner' });
		// the redirect lands on the consultees table (#consultees)
		const categoryPageUrl = added.headers.location.replace(/#.*$/, '');

		// the row's Remove link opens the remove page - here, targeting the add by index
		const removeUrl = categoryPageUrl.replace('/report/consultees?', '/report/consultees/remove?') + '&added=0';
		const removePage = await agent.get(removeUrl);
		assert.equal(removePage.status, 200);
		assert.match(removePage.text, /Remove consultee/);
		assert.match(removePage.text, /Router Test Consultee/);
		const removeCsrf = /name="_csrf" value="([^"]+)"/.exec(removePage.text)?.[1];
		assert.ok(removeCsrf, 'expected the remove form to carry a CSRF token');

		const response = await agent.post(removeUrl).type('form').send({ _csrf: removeCsrf, reason: 'Added in error' });
		assert.equal(response.status, 302);
		const location = response.headers.location;
		assert.match(
			location,
			/\/report\/consultees\?ruleset=england-wales-post-20240430&category=Parish%2C%20town%20and%20community%20councils&exclude=/
		);
		assert.match(location, /removed=open/);

		const categoryPage = await agent.get(location);
		assert.equal(categoryPage.status, 200);
		// off the included table, into the expandable Removed consultees section
		assert.match(categoryPage.text, /Removed consultees/);
		assert.match(categoryPage.text, /Added in error/);
	});

	test('POST /consultees/:id/report/consultees/remove re-renders with an error when the reason is blank', async () => {
		const agent = request.agent(authDisabledApp);
		const page = await agent.get(
			`/consultees/${homePageTestCaseId}/report/consultees/add?ruleset=england-wales-post-20240430&category=Parish%2C%20town%20and%20community%20councils`
		);
		const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
		const added = await agent
			.post(
				`/consultees/${homePageTestCaseId}/report/consultees/add?ruleset=england-wales-post-20240430&category=Parish%2C%20town%20and%20community%20councils`
			)
			.type('form')
			.send({ _csrf: csrf, name: 'Router Test Consultee', reason: 'Adjacent landowner' });
		const removeUrl =
			added.headers.location.replace(/#.*$/, '').replace('/report/consultees?', '/report/consultees/remove?') +
			'&added=0';

		const response = await agent.post(removeUrl).type('form').send({ _csrf: csrf, reason: '' });
		assert.equal(response.status, 200);
		assert.match(response.text, /There is a problem/);
		assert.match(response.text, /Enter a reason for removing this consultee(?!\.)/);
	});

	test('GET /consultees/:id/report/consultees/remove 404s without a target', async () => {
		const response = await request(authDisabledApp).get(
			`/consultees/${homePageTestCaseId}/report/consultees/remove?ruleset=england-wales-post-20240430&category=Parish%2C%20town%20and%20community%20councils`
		);
		assert.equal(response.status, 404);
	});

	test('GET /consultees/:id/report/created renders the report created page', async () => {
		// the page builds the report's map PDFs - never the real tile server from a test
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
			const response = await request(authDisabledApp).get(
				`/consultees/${homePageTestCaseId}/report/created?ruleset=england-wales-post-20240430`
			);
			assert.equal(response.status, 200);
			assert.match(response.text, /Report created/);
			assert.match(response.text, /Download Router Test Fixture Wind Farm Consultee List report \(ZIP/);
		} finally {
			globalThis.fetch = originalFetch;
		}
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
				`/consultees/${homePageTestCaseId}/results/static-map?ruleset=england-wales-post-20240430`
			);
			assert.equal(response.status, 200);
			assert.match(response.headers['content-type'] || '', /image\/(svg\+xml|png)/);
			// case-derived images are authenticated content - private so shared caches can't serve them
			assert.match(response.headers['cache-control'] || '', /^private, max-age=/);
			assert.ok(response.headers.etag);

			const cached = await request(authDisabledApp)
				.get(`/consultees/${homePageTestCaseId}/results/static-map?ruleset=england-wales-post-20240430`)
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
				`/consultees/${homePageTestCaseId}/results/static-map.svg?ruleset=england-wales-post-20240430`
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

	test('GET /help needs signing in, unlike the footer policy pages', async () => {
		const service = new ManageService(buildManageTestConfig(false));
		const app = createManageTestApp(service);
		try {
			const help = await request(app).get('/help');
			assert.equal(help.status, 302);
			assert.equal((await request(app).get('/cookies')).status, 200);
		} finally {
			await service.db.$disconnect().catch(() => undefined);
		}
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
