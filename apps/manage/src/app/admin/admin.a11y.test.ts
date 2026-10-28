import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { configureNunjucks } from '../nunjucks.ts';
import { assertNoSeriousA11yViolations, pageLocals } from '../testing/a11y.ts';
import { adminNavigation } from './navigation.ts';

// what admin/index.ts puts on every admin page: the header link and the menu
const adminLocals = { ...pageLocals, adminLink: { href: '/admin', active: true } };

describe('admin page accessibility smoke', () => {
	const nunjucks = configureNunjucks();
	const navFor = (path: string) => ({ adminNav: adminNavigation(path) });

	test('admin import from CBOS page has no serious a11y violations', async () => {
		const html = nunjucks.render('admin/import-from-cbos/view.njk', {
			...adminLocals,
			...navFor('/admin/import-from-cbos'),
			pageHeading: 'Import cases from CBOS',
			_csrf: 'test-csrf',
			loaded: { cases: 270, boundaries: 300, casesFromCbos: 110, boundariesFromCbos: 120 }
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('admin import from CBOS page with a result has no serious a11y violations', async () => {
		const html = nunjucks.render('admin/import-from-cbos/view.njk', {
			...adminLocals,
			...navFor('/admin/import-from-cbos'),
			pageHeading: 'Import cases from CBOS',
			_csrf: 'test-csrf',
			filesFound: 3,
			imported: 2,
			casesImported: 2,
			failures: [{ caseReference: 'EN010001', fileName: 'broken.geojson', reason: 'status 500' }]
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('admin import from CBOS page with an error has no serious a11y violations', async () => {
		const html = nunjucks.render('admin/import-from-cbos/view.njk', {
			...adminLocals,
			...navFor('/admin/import-from-cbos'),
			pageHeading: 'Import cases from CBOS',
			_csrf: 'test-csrf',
			error: 'Could not import case boundaries from CBOS.',
			cause: 'Python function cbos/boundary-files responded with status 500',
			connection: {
				database: { status: 'ERROR', detail: "Error: Login failed for user '<token-identified principal>'" },
				storage: { status: 'OK', detail: 'listed 5 blob name(s) in document-service-uploads' }
			}
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('admin home lists every admin page beside the menu, with no serious a11y violations', async () => {
		const html = nunjucks.render('admin/home/view.njk', {
			...adminLocals,
			...navFor('/admin'),
			pageHeading: 'Admin',
			pages: [{ href: '/admin/database', text: 'Database', description: "What's loaded." }]
		});
		// one h1 - the main layout's is left out
		assert.equal(html.match(/<h1/g)?.length, 1);
		assert.match(
			html,
			/<a class="govuk-link govuk-link--no-visited-state" href="\/admin" aria-current="page">Overview<\/a>/
		);
		assert.match(html, /<a class="govuk-service-navigation__link" href="\/admin" aria-current="true">/);
		await assertNoSeriousA11yViolations(html);
	});

	test('admin database overview has no serious a11y violations', async () => {
		const html = nunjucks.render('admin/database/overview.njk', {
			...adminLocals,
			...navFor('/admin/database'),
			pageHeading: 'Database',
			tables: [
				{
					name: 'consultee_area',
					description: 'The reference data.',
					rows: '13,691',
					lastUpdated: '13 Oct 2026, 14:39',
					href: '/admin/database/consultee-areas'
				},
				{
					name: 'case_boundary',
					description: 'Case boundaries.',
					rows: '0',
					lastUpdated: '',
					href: '/admin/database/case-boundaries'
				}
			],
			categories: [
				{ name: 'Parish <Council>', rows: '10,000', href: '/admin/database/consultee-areas?category=Parish+Council' },
				{ name: 'No category', rows: '3' }
			]
		});
		assert.match(html, /Parish &lt;Council&gt;/);
		assert.match(html, /Never/);
		await assertNoSeriousA11yViolations(html);

		const empty = nunjucks.render('admin/database/overview.njk', {
			...adminLocals,
			...navFor('/admin/database'),
			pageHeading: 'Database',
			tables: [],
			categories: []
		});
		assert.match(empty, /No consultee areas are loaded/);
	});

	test('admin database lists, filtered and paged, have no serious a11y violations', async () => {
		const pagination = {
			next: { href: '/admin/database/consultee-areas?page=2' },
			items: [
				{ number: 1, href: '/admin/database/consultee-areas', current: true },
				{ number: 2, href: '/admin/database/consultee-areas?page=2' }
			]
		};
		const areas = nunjucks.render('admin/database/consultee-areas.njk', {
			...adminLocals,
			...navFor('/admin/database/consultee-areas'),
			pageHeading: 'Consultee areas',
			backLinkUrl: '/admin/database',
			categoryItems: [
				{ value: '', text: 'Every category', selected: false },
				{ value: 'Parish Council', text: 'Parish Council', selected: true }
			],
			search: 'bart',
			showing: 'Showing 1 to 50 of 51 rows.',
			rows: [
				{
					href: '/admin/database/consultee-areas/11111111-1111-1111-1111-111111111111',
					consultee: 'Barton & <Co>',
					category: 'Parish Council',
					region: '',
					geometryType: 'Polygon',
					lastUpdated: '13 Oct 2026, 14:38'
				}
			],
			pagination
		});
		assert.match(areas, /Barton &amp; &lt;Co&gt;/);
		await assertNoSeriousA11yViolations(areas);

		const boundaries = nunjucks.render('admin/database/case-boundaries.njk', {
			...adminLocals,
			...navFor('/admin/database/case-boundaries'),
			pageHeading: 'Case boundaries',
			backLinkUrl: '/admin/database',
			search: '',
			showing: 'No rows match.',
			rows: [],
			pagination: null
		});
		assert.doesNotMatch(boundaries, /<table/);
		await assertNoSeriousA11yViolations(boundaries);

		const someBoundaries = nunjucks.render('admin/database/case-boundaries.njk', {
			...adminLocals,
			...navFor('/admin/database/case-boundaries'),
			pageHeading: 'Case boundaries',
			search: 'EN01',
			showing: 'Showing 1 to 1 of 1 rows.',
			rows: [
				{
					href: '/admin/database/case-boundaries/22222222-2222-2222-2222-222222222222',
					caseReference: 'EN010001',
					caseName: 'Test Solar Farm',
					fileName: 'site.geojson',
					receivedDate: '6 Jul 2026, 01:00',
					geometryType: 'Polygon'
				}
			],
			pagination
		});
		await assertNoSeriousA11yViolations(someBoundaries);
	});

	test('admin database row page has no serious a11y violations', async () => {
		const html = nunjucks.render('admin/database/row.njk', {
			...adminLocals,
			...navFor('/admin/database/consultee-areas/11111111-1111-1111-1111-111111111111'),
			pageHeading: 'Barton',
			backLinkUrl: '/admin/database/consultee-areas',
			columns: [
				{ name: 'id', value: '11111111-1111-1111-1111-111111111111' },
				{ name: 'region', value: '' }
			],
			metadata: '{\n  "FID": 1\n}'
		});
		assert.match(html, /<pre class="pins-admin-json" tabindex="0">\{/);
		await assertNoSeriousA11yViolations(html);
	});

	test('admin upload and import pages, in the admin layout, have no serious a11y violations', async () => {
		for (const [view, path, locals] of [
			['admin/upload-to-blob/view.njk', '/admin/upload-to-blob', { pageHeading: 'Upload a file to blob storage' }],
			[
				'admin/import-reference-data/view.njk',
				'/admin/import-reference-data',
				{ pageHeading: 'Import reference data into the database', loadedConsulteeAreas: 1, loadedCaseBoundaries: 2 }
			]
		] as const) {
			const html = nunjucks.render(view, { ...adminLocals, ...navFor(path), _csrf: 'test-csrf', ...locals });
			assert.equal(html.match(/<h1/g)?.length, 1);
			await assertNoSeriousA11yViolations(html);
		}
	});
});
