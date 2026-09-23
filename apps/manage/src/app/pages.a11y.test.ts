import axe from 'axe-core';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { configureNunjucks } from './nunjucks.ts';

const pageLocals = {
	config: {
		styleFile: 'style.css',
		headerTitle: 'Identify consultees',
		footerLinks: []
	},
	cspNonce: 'test-nonce'
};

async function assertNoSeriousA11yViolations(html: string) {
	const dom = new JSDOM(html);
	const results = await axe.run(dom.window.document.documentElement, {
		// jsdom cannot compute styles reliably
		rules: {
			'color-contrast': { enabled: false },
			'link-in-text-block': { enabled: false }
		}
	});

	const serious = results.violations.filter(
		(violation) => violation.impact === 'critical' || violation.impact === 'serious'
	);

	assert.equal(serious.length, 0, serious.map((violation) => `${violation.id}: ${violation.help}`).join('\n'));
}

describe('manage page accessibility smoke', () => {
	const nunjucks = configureNunjucks();

	test('401 error page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/errors/401.njk', {
			...pageLocals,
			pageHeading: 'Sorry, there is a problem with your login'
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('403 error page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/errors/403.njk', {
			...pageLocals,
			pageHeading: 'You do not have access to this service'
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('404 error page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/errors/404.njk', {
			...pageLocals,
			pageHeading: 'Page not found'
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('500 error page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/errors/500.njk', {
			...pageLocals,
			pageHeading: 'Sorry, there is a problem with the service'
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('items list page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/items/list/view.njk', {
			...pageLocals,
			pageHeading: 'Some Service Name',
			items: [
				{ task: 'Create new service', done: true },
				{ task: 'Implement a new feature', done: false }
			]
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('home page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/home/view.njk', {
			...pageLocals,
			pageHeading: 'Identify consultees for an infrastructure project',
			rulesets: [{ value: 'post-apr-2025-england-wales', text: 'Post Apr 2025 England & Wales' }],
			selectedRuleset: 'post-apr-2025-england-wales',
			searchQuery: 'EN01',
			pageSize: 25,
			pageSizeOptions: [25, 50, 100],
			resultsFrom: 1,
			resultsTo: 3,
			resultsTotal: 3889,
			selectedGeometryId: 'geo-1',
			geometries: [
				{
					id: 'geo-1',
					reference: 'EN0110036',
					caseName: 'Gwynt Glas Offshore Wind Farm',
					geometryProjectStage: 'Acceptance',
					version: '3',
					received: '03/03/2026',
					uploadedToCbos: '10/03/2026 00:00:00'
				},
				{
					id: 'geo-2',
					reference: 'EN0110036',
					caseName: 'Gwynt Glas Offshore Wind Farm',
					geometryProjectStage: 'Scoping',
					version: '2',
					received: '15/01/2026',
					uploadedToCbos: '20/01/2026 00:00:00'
				}
			]
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('signed out page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/signed-out/view.njk', {
			...pageLocals,
			hideSignOut: true,
			signInHref: '/'
		});
		await assertNoSeriousA11yViolations(html);
	});
});
