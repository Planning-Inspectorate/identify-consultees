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
		vendorInteractiveMapJs: 'vendor/interactive-map/js/index.js',
		vendorInteractiveMapCss: 'vendor/interactive-map/css/index.css',
		vendorMaplibreProviderJs: 'vendor/maplibre-provider/js/index.js',
		interactiveMapExamplesJs: 'javascripts/interactive-map-examples.js',
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
			pageHeading: 'Identify consultees for a NSIP project',
			searchQuery: 'EN01',
			pageSize: 25,
			pageSizeOptions: [25, 50, 100],
			resultsFrom: 1,
			resultsTo: 3,
			resultsTotal: 100,
			pagination: {
				next: { href: '/?q=EN01&pageSize=25&page=2' },
				items: [
					{ number: 1, href: '/?q=EN01&pageSize=25&page=1', current: true },
					{ number: 2, href: '/?q=EN01&pageSize=25&page=2' },
					{ number: 3, href: '/?q=EN01&pageSize=25&page=3' },
					{ ellipsis: true },
					{ number: 100, href: '/?q=EN01&pageSize=25&page=100' }
				]
			},
			exampleCase: { reference: 'EN010025', caseName: 'East Anglia ONE Offshore Windfarm' },
			geometries: [
				{
					id: '11111111-1111-1111-1111-111111111111',
					reference: 'EN010025',
					caseName: 'East Anglia ONE Offshore Windfarm',
					stage: 'Acceptance'
				},
				{
					id: '22222222-2222-2222-2222-222222222222',
					reference: 'EN010013',
					caseName: 'Clocaenog Forest Wind Farm',
					stage: null
				}
			]
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('home page with no search results has no serious a11y violations', async () => {
		const html = nunjucks.render('views/home/view.njk', {
			...pageLocals,
			pageHeading: 'Identify consultees for a NSIP project',
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
			pageHeading: 'Ruleset',
			backLinkUrl: '/consultees/11111111-1111-1111-1111-111111111111?ruleset=example-ruleset',
			caseId: '11111111-1111-1111-1111-111111111111',
			_csrf: 'test-csrf',
			rulesets: [
				{ value: 'example-ruleset', text: 'Example ruleset', checked: true },
				{ value: 'other-ruleset', text: 'Other ruleset', checked: false }
			]
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('shapefile picker page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultees/shapefile/view.njk', {
			...pageLocals,
			pageHeading: 'Project shapefile',
			backLinkUrl: '/consultees/11111111-1111-1111-1111-111111111111?ruleset=example-ruleset',
			caseId: '11111111-1111-1111-1111-111111111111',
			rulesetId: 'example-ruleset',
			_csrf: 'test-csrf',
			files: [
				{
					value: '11111111-1111-1111-1111-111111111111',
					text: 'EN0110007.geojson',
					hint: { text: 'Uploaded: 11:20, 19 Sept 2026' },
					checked: true
				},
				{
					value: '22222222-2222-2222-2222-222222222222',
					text: 'Longfield solar farm shapefiles.geojson',
					hint: { text: 'Uploaded: 12:16, 29 Jul 2026' },
					checked: false
				}
			]
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('consultee project map page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultees/project/view.njk', {
			...pageLocals,
			pageHeading: 'Longfield Solar Farm',
			reference: 'EN0110007',
			caseName: 'Longfield Solar Farm',
			caseId: '11111111-1111-1111-1111-111111111111',
			backLinkUrl: '/',
			backLinkText: 'Back to projects',
			sectorDescription: 'Energy, Generating Stations, Solar',
			stage: 'Acceptance',
			shapefileName: 'EN0110007.geojson',
			shapefileChangeUrl: '/consultees/11111111-1111-1111-1111-111111111111/shapefile?ruleset=example-ruleset',
			rulesetName: 'Example ruleset',
			rulesetChangeUrl: '/consultees/11111111-1111-1111-1111-111111111111/ruleset?ruleset=example-ruleset',
			previewReportUrl: '/consultees/11111111-1111-1111-1111-111111111111/report?ruleset=example-ruleset',
			mapId: 'case-map',
			mapRegionLabel: 'Map showing Example ruleset for Longfield Solar Farm',
			staticMapSrc: '/consultees/11111111-1111-1111-1111-111111111111/results/static-map?ruleset=example-ruleset',
			staticMapAlt: 'Static map showing Example ruleset for Longfield Solar Farm',
			mapWidth: 960,
			mapHeight: 516,
			mapConfigJson: '{"center":[-1.78,50.62],"zoom":11}',
			rulesetFailed: false,
			retryUrl: '/consultees/11111111-1111-1111-1111-111111111111?ruleset=example-ruleset',
			matchCount: 120,
			mapIsSampled: true,
			mapSampleSize: 30
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('consultee project map page when the ruleset could not be run has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultees/project/view.njk', {
			...pageLocals,
			pageHeading: 'Longfield Solar Farm',
			reference: 'EN0110007',
			caseName: 'Longfield Solar Farm',
			caseId: '11111111-1111-1111-1111-111111111111',
			backLinkUrl: '/',
			backLinkText: 'Back to projects',
			sectorDescription: null,
			stage: null,
			shapefileName: 'Not provided',
			shapefileChangeUrl: '/consultees/11111111-1111-1111-1111-111111111111/shapefile?ruleset=example-ruleset',
			rulesetName: 'Example ruleset',
			rulesetChangeUrl: '/consultees/11111111-1111-1111-1111-111111111111/ruleset?ruleset=example-ruleset',
			previewReportUrl: '/consultees/11111111-1111-1111-1111-111111111111/report?ruleset=example-ruleset',
			mapId: 'case-map',
			mapRegionLabel: 'Map showing Example ruleset for Longfield Solar Farm',
			staticMapSrc: '/consultees/11111111-1111-1111-1111-111111111111/results/static-map?ruleset=example-ruleset',
			staticMapAlt: 'Static map showing Example ruleset for Longfield Solar Farm',
			mapWidth: 960,
			mapHeight: 516,
			mapConfigJson: '{"center":[-1.78,50.62],"zoom":11}',
			rulesetFailed: true,
			retryUrl: '/consultees/11111111-1111-1111-1111-111111111111?ruleset=example-ruleset',
			matchCount: 0,
			mapIsSampled: false,
			mapSampleSize: 30
		});
		assert.match(html, /The ruleset could not be run/);
		await assertNoSeriousA11yViolations(html);
	});

	test('consultee report check page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultees/report/view.njk', {
			...pageLocals,
			pageHeading: 'Check consultees before creating the report',
			backLinkUrl: '/consultees/11111111-1111-1111-1111-111111111111?ruleset=example-ruleset',
			caseName: 'Longfield Solar Farm',
			reference: 'EN0110007',
			stage: 'Acceptance',
			caseChangeUrl: '/',
			rulesetName: 'Example ruleset',
			rulesetChangeUrl: '/consultees/11111111-1111-1111-1111-111111111111/ruleset?ruleset=example-ruleset',
			consultees: [
				{ name: 'Parish Council', count: '3', changeUrl: '#' },
				{ name: 'Railway', count: '12', changeUrl: '#' }
			],
			generateReportUrl: '/consultees/11111111-1111-1111-1111-111111111111/report/created?ruleset=example-ruleset',
			rulesetFailed: false,
			retryUrl: '/consultees/11111111-1111-1111-1111-111111111111?ruleset=example-ruleset'
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('report created page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultees/report/created.njk', {
			...pageLocals,
			pageHeading: 'Report created',
			backLinkUrl: '/consultees/11111111-1111-1111-1111-111111111111?ruleset=example-ruleset',
			caseName: 'Longfield Solar Farm',
			reference: 'EN0110007',
			downloadUrl: '#',
			downloadText: 'Download Longfield Solar Farm scoping report (ZIP)'
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
			interactiveMapHref: '/components/interactive-map',
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

	test('interactive map examples index page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/interactive-map-examples/view.njk', {
			...pageLocals,
			pageHeading: 'Interactive map',
			backLinkUrl: '/components?components=true',
			backLinkText: 'Back to components',
			examples: [
				{
					id: 'basic',
					title: 'Basic map',
					summary: 'A minimal inline map.',
					href: '/components/interactive-map/basic?components=true',
					behaviourLabel: 'Inline',
					pluginsLabel: 'None'
				}
			]
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('interactive map example page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/interactive-map-examples/example.njk', {
			...pageLocals,
			pageHeading: 'Basic map',
			backLinkUrl: '/components/interactive-map?components=true',
			backLinkText: 'Back to interactive map examples',
			summary: 'A minimal inline map on the default OpenFreeMap basemap.',
			interaction: 'Pan with the mouse or arrow keys.',
			mapId: 'interactive-map-example-basic',
			mapRegionLabel: 'Map of the Dorset coast around the demo project site',
			staticMapSrc: '/components/interactive-map/basic/static-map',
			staticMapAlt: 'Static map of the Dorset coast centred on the demo project site.',
			mapWidth: 960,
			mapHeight: 516,
			mapConfigJson: '{"kind":"basic","center":[-1.78,50.62],"zoom":11}',
			pluginStylesheets: [],
			pluginScripts: [],
			behaviourLabel: 'Inline',
			pluginsLabel: 'None'
		});
		await assertNoSeriousA11yViolations(html);
		assert.match(html, /role="region"/);
		assert.match(html, /<noscript>[\s\S]*<img/);
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
			mapSampleSize: 30,
			nearbyMatches: [],
			nearbyMatchCount: 0,
			nearbyRadiusKm: 20
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
			mapSampleSize: 30,
			nearbyMatches: [
				{ consultee: 'Network Rail', consulteeCategory: 'Railway', region: 'South West', distanceMetres: 123 },
				{ consultee: 'Example Hospital', consulteeCategory: 'Hospital', region: 'South West', distanceMetres: 4500 }
			],
			nearbyMatchCount: 2,
			nearbyRadiusKm: 20
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('consultees results page when the ruleset could not be run has no serious a11y violations', async () => {
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
			rulesetFailed: true,
			retryUrl: '/consultees/11111111-1111-1111-1111-111111111111/results?ruleset=example-ruleset',
			staticMapAlt: 'Static map showing Example ruleset for Example Project',
			mapWidth: 960,
			mapHeight: 516,
			mapConfigJson: '{"center":[-1.78,50.62],"zoom":11}',
			matches: [],
			matchCount: 0,
			mapIsSampled: false,
			mapSampleSize: 30,
			nearbyMatches: [],
			nearbyMatchCount: 0,
			nearbyRadiusKm: 20
		});
		assert.match(html, /The ruleset could not be run/);
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
