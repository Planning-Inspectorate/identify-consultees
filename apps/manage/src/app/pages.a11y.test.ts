import axe from 'axe-core';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	createGovukNunjucksEnvironment,
	getVisibleFixtures,
	loadComponentCatalogue,
	renderGovukComponent,
	scopeFixtureIds
} from './govuk-frontend-components.ts';
import { configureNunjucks } from './nunjucks.ts';

const pageLocals = {
	config: {
		styleFile: 'style.css',
		govukFrontendJs: 'assets/js/govuk-frontend.min.js',
		consulteesMapJs: 'javascripts/consultees-map.js',
		mapLayersDemoJs: 'javascripts/map-layers-demo.js',
		accessibleAutocompleteJs: 'assets/js/accessible-autocomplete.min.js',
		accessibleAutocompleteCss: 'assets/css/accessible-autocomplete.min.css',
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
			searchQuery: 'EN01',
			pageSize: 25,
			pageSizeOptions: [25, 50, 100],
			resultsFrom: 1,
			resultsTo: 3,
			resultsTotal: 100,
			exampleCase: { reference: 'EN010025', caseName: 'East Anglia ONE Offshore Windfarm' },
			geometries: [
				{
					id: '11111111-1111-1111-1111-111111111111',
					reference: 'EN010025',
					caseName: 'East Anglia ONE Offshore Windfarm',
					received: '03/03/2026'
				},
				{
					id: '22222222-2222-2222-2222-222222222222',
					reference: 'EN010013',
					caseName: 'Clocaenog Forest Wind Farm',
					received: '15/01/2026'
				}
			]
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('home page with no search results has no serious a11y violations', async () => {
		const html = nunjucks.render('views/home/view.njk', {
			...pageLocals,
			pageHeading: 'Identify consultees for an infrastructure project',
			searchQuery: 'ZZZ-NOMATCH-XXX',
			pageSize: 25,
			pageSizeOptions: [25, 50, 100],
			resultsFrom: 0,
			resultsTo: 0,
			resultsTotal: 0,
			exampleCase: null,
			geometries: []
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('ruleset picker page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultees/ruleset/view.njk', {
			...pageLocals,
			pageHeading: 'Choose a ruleset for Example Project (EN01)',
			backLinkUrl: '/',
			caseId: '11111111-1111-1111-1111-111111111111',
			reference: 'EN01',
			caseName: 'Example Project',
			rulesets: [{ value: 'example-ruleset', text: 'Example ruleset' }]
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

	test('components index page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/components/view.njk', {
			...pageLocals,
			pageHeading: 'GOV.UK Frontend components',
			components: [
				{ name: 'button', title: 'Button', href: '/components/button', exampleCount: 22 },
				{ name: 'tag', title: 'Tag', href: '/components/tag', exampleCount: 9 }
			]
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('component detail page has no serious a11y violations', async () => {
		const env = createGovukNunjucksEnvironment();
		const entry = loadComponentCatalogue().find((item) => item.component === 'checkboxes');
		assert.ok(entry);
		const examples = getVisibleFixtures(entry).map((fixture, index) => ({
			name: fixture.name,
			html: scopeFixtureIds(renderGovukComponent(env, 'checkboxes', fixture.options), `checkboxes-${index}`)
		}));

		const html = nunjucks.render('views/components/component.njk', {
			...pageLocals,
			pageHeading: 'Checkboxes',
			componentName: 'checkboxes',
			backLinkUrl: '/components',
			backLinkText: 'Back to components',
			examples
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('map layers demo page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/map-layers-demo/view.njk', {
			...pageLocals,
			pageHeading: 'Map layers demo',
			mapId: 'map-layers-demo',
			mapRegionLabel: 'Interactive map with toggleable overlay layers',
			mapWidth: 960,
			mapHeight: 516,
			mapConfigJson: '{"center":[-1.78,50.62],"zoom":11}',
			layerSummaries: [
				{ label: 'Project site', description: 'Polygon overlay for the indicative project boundary.' },
				{ label: 'Railway lines', description: 'Line overlays representing train tracks.' },
				{ label: 'Road network', description: 'Line overlays representing roads.' },
				{ label: 'Flood risk area', description: 'Polygon overlay for a constraint.' }
			]
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('consultees results page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultees/results/view.njk', {
			...pageLocals,
			pageHeading: 'Consultees identified for Example Project (EN01)',
			backLinkUrl: '/consultees/11111111-1111-1111-1111-111111111111',
			rulesetName: 'Example ruleset',
			reference: 'EN01',
			caseName: 'Example Project',
			caseId: '11111111-1111-1111-1111-111111111111',
			mapId: 'case-map',
			mapRegionLabel: 'Map showing Example ruleset for Example Project',
			staticMapSrc: '/consultees/11111111-1111-1111-1111-111111111111/results/static-map?ruleset=example-ruleset',
			staticMapAlt: 'Static map showing Example ruleset for Example Project',
			mapWidth: 960,
			mapHeight: 516,
			mapConfigJson: '{"center":[-1.78,50.62],"zoom":11}',
			matches: [{ consultee: 'Network Rail', consulteeCategory: 'Railway', region: 'South West', distanceMetres: 123 }],
			matchCount: 1,
			mapIsSampled: false,
			mapSampleSize: 30
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('consultees results page with a sampled map has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultees/results/view.njk', {
			...pageLocals,
			pageHeading: 'Consultees identified for Example Project (EN01)',
			backLinkUrl: '/consultees/11111111-1111-1111-1111-111111111111',
			rulesetName: 'Example ruleset',
			reference: 'EN01',
			caseName: 'Example Project',
			caseId: '11111111-1111-1111-1111-111111111111',
			mapId: 'case-map',
			mapRegionLabel: 'Map showing Example ruleset for Example Project',
			staticMapSrc: '/consultees/11111111-1111-1111-1111-111111111111/results/static-map?ruleset=example-ruleset',
			staticMapAlt: 'Static map showing Example ruleset for Example Project',
			mapWidth: 960,
			mapHeight: 516,
			mapConfigJson: '{"center":[-1.78,50.62],"zoom":11}',
			matches: [{ consultee: 'Network Rail', consulteeCategory: 'Railway', region: 'South West', distanceMetres: 123 }],
			matchCount: 120,
			mapIsSampled: true,
			mapSampleSize: 30
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('firewall error page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/static/error/firewall-error.njk', {
			...pageLocals,
			pageHeading: 'Sorry, there is a problem with the service'
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('consultee areas python page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultee-areas-python/view.njk', {
			...pageLocals,
			pageHeading: 'Consultee areas (Python function)',
			_csrf: 'test-csrf',
			rows: [
				{
					id: '1',
					geometryType: 'Polygon',
					consulteeCategory: 'Statutory',
					consultee: 'Example Trust',
					region: 'South West',
					caseReference: 'EN01',
					currentVersion: 1,
					metadata: '{}',
					lastUpdated: '2026-01-01',
					geometryWkt: 'POLYGON((0 0,1 0,1 1,0 1,0 0))'
				}
			]
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('consultee areas python page with an error has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultee-areas-python/view.njk', {
			...pageLocals,
			pageHeading: 'Consultee areas (Python function)',
			_csrf: 'test-csrf',
			error: 'PYTHON_FUNCTION_URL is not configured'
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('consultee areas python page with empty rows has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultee-areas-python/view.njk', {
			...pageLocals,
			pageHeading: 'Consultee areas (Python function)',
			_csrf: 'test-csrf',
			rows: []
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('500 error page with development details has no serious a11y violations', async () => {
		const html = nunjucks.render('views/errors/500.njk', {
			...pageLocals,
			pageHeading: 'Sorry, there is a problem with the service',
			isDevelopment: true,
			error: { message: 'boom', stack: 'Error: boom\n    at test' }
		});
		await assertNoSeriousA11yViolations(html);
	});
});
