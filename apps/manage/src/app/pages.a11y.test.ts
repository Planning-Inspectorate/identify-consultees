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
import { assertNoSeriousA11yViolations, pageLocals } from './testing/a11y.ts';

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

	test('error scenarios index page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/error-test/view.njk', {
			...pageLocals,
			pageHeading: 'Error scenarios',
			statusPages: [
				{ href: '/error-test/401', label: '401', description: 'the login problem page' },
				{ href: '/error-test/500', label: '500', description: 'deliberately throws' }
			],
			livePages: [{ href: '/unauthenticated', label: 'Login problem', description: 'the real 401 route' }],
			csrfCheckAction: '/error-test/csrf-check',
			rateLimitedHref: '/error-test/rate-limited',
			// render the success banner too so both states are covered
			csrfAccepted: true
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('home page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/home/view.njk', {
			...pageLocals,
			pageHeading: 'Identify consultees for a NSIP project',
			searchQuery: 'EN01',
			pageSize: 25,
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
			resultsFrom: 0,
			resultsTo: 0,
			resultsTotal: 0,
			geometries: []
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('ruleset picker page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultees/ruleset/view.njk', {
			...pageLocals,
			pageHeading: 'Ruleset',
			pageCaption: 'Longfield Solar Farm',
			backLinkUrl: '/consultees/11111111-1111-1111-1111-111111111111',
			caseId: '11111111-1111-1111-1111-111111111111',
			formAction: '/consultees/11111111-1111-1111-1111-111111111111/ruleset?ruleset=england-wales-post-20240430',
			_csrf: 'test-csrf',
			rulesets: [
				{ value: 'england-wales-post-20240430', text: 'England Wales post 30 April 2024', checked: true },
				{ value: 'other-ruleset', text: 'Other ruleset', checked: false }
			]
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('consultee project boundary page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultees/project/view.njk', {
			...pageLocals,
			pageHeading: 'Project boundary',
			pageCaption: 'Longfield Solar Farm',
			reference: 'EN0110007',
			caseName: 'Longfield Solar Farm',
			caseId: '11111111-1111-1111-1111-111111111111',
			backLinkUrl: '/',
			backLinkText: 'Back to projects',
			formAction: '/consultees/11111111-1111-1111-1111-111111111111',
			_csrf: 'test-csrf',
			files: [
				{
					value: '11111111-1111-1111-1111-111111111111',
					text: 'EN0110007.geojson',
					hint: { text: 'Uploaded: 11:20, 19 Sept 2026' }
				},
				{
					value: '22222222-2222-2222-2222-222222222222',
					text: 'EN0110007-acceptance.geojson',
					hint: { text: 'Uploaded: 12:16, 29 Jul 2026' }
				}
			],
			mapId: 'case-map',
			mapRegionLabel: 'Map showing the project boundary for Longfield Solar Farm',
			staticMapSrc: '/consultees/11111111-1111-1111-1111-111111111111/boundary-map',
			staticMapAlt: 'Static map showing the project boundary for Longfield Solar Farm',
			mapWidth: 960,
			mapHeight: 516,
			mapConfigJson: '{"center":[-1.78,50.62],"zoom":11}'
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('consultee report check page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultees/report/view.njk', {
			...pageLocals,
			pageHeading: 'Check consultees before creating the report',
			backLinkUrl: '/consultees/11111111-1111-1111-1111-111111111111/ruleset?ruleset=england-wales-post-20240430',
			caseName: 'Longfield Solar Farm',
			reference: 'EN0110007',
			caseChangeUrl: '/',
			shapefileName: 'EN0110007.geojson',
			shapefileChangeUrl: '/consultees/11111111-1111-1111-1111-111111111111',
			rulesetName: 'England Wales post 30 April 2024',
			rulesetChangeUrl: '/consultees/11111111-1111-1111-1111-111111111111/ruleset?ruleset=england-wales-post-20240430',
			groups: [
				{
					name: 'Administrative boundaries',
					consultees: [
						{
							name: 'Parish Council',
							names: [
								'Little Snoring Parish Council',
								'Great Snoring Parish Council',
								'Barmer Parish Council',
								'Fulmodeston Parish Council',
								'Brinton Parish Council',
								'Bale Parish Council',
								'Briston Parish Council'
							],
							changeUrl: '#'
						}
					]
				},
				{
					name: 'Public bodies',
					consultees: [
						{
							name: 'Police and Crime Commission',
							names: ['Norfolk Police and Crime Commissioner'],
							changeUrl: '#'
						},
						{ name: 'Railway', names: [], changeUrl: '#' }
					]
				}
			],
			generateReportUrl:
				'/consultees/11111111-1111-1111-1111-111111111111/report/created?ruleset=england-wales-post-20240430',
			rulesetFailed: false,
			retryUrl: '/consultees/11111111-1111-1111-1111-111111111111/report?ruleset=england-wales-post-20240430'
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('consultee report check page when the ruleset could not be run has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultees/report/view.njk', {
			...pageLocals,
			pageHeading: 'Check consultees before creating the report',
			backLinkUrl: '/consultees/11111111-1111-1111-1111-111111111111/ruleset?ruleset=england-wales-post-20240430',
			caseName: 'Longfield Solar Farm',
			reference: 'EN0110007',
			caseChangeUrl: '/',
			shapefileName: 'EN0110007.geojson',
			shapefileChangeUrl: '/consultees/11111111-1111-1111-1111-111111111111',
			rulesetName: 'England Wales post 30 April 2024',
			rulesetChangeUrl: '/consultees/11111111-1111-1111-1111-111111111111/ruleset?ruleset=england-wales-post-20240430',
			groups: [],
			generateReportUrl:
				'/consultees/11111111-1111-1111-1111-111111111111/report/created?ruleset=england-wales-post-20240430',
			rulesetFailed: true,
			retryUrl: '/consultees/11111111-1111-1111-1111-111111111111/report?ruleset=england-wales-post-20240430'
		});
		assert.match(html, /The ruleset could not be run/);
		await assertNoSeriousA11yViolations(html);
	});

	test('report consultees change page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultees/report/consultees/view.njk', {
			...pageLocals,
			pageHeading: 'Parish Council',
			pageCaption: 'Longfield Solar Farm',
			backLinkUrl: '/consultees/11111111-1111-1111-1111-111111111111/report?ruleset=england-wales-post-20240430',
			rows: [
				{
					name: 'Little Snoring Parish Council',
					identified: ['"B" host Parishes or Community Councils: intersects the site', 'Within 20km of the site'],
					removeUrl:
						'/consultees/11111111-1111-1111-1111-111111111111/report/consultees?ruleset=england-wales-post-20240430&category=Parish%20Council&exclude=55555555-5555-5555-5555-555555555555'
				}
			],
			addConsulteeUrl:
				'/consultees/11111111-1111-1111-1111-111111111111/report/consultees/add?ruleset=england-wales-post-20240430&category=Parish%20Council',
			saveAndReturnUrl: '/consultees/11111111-1111-1111-1111-111111111111/report?ruleset=england-wales-post-20240430',
			mapId: 'case-map',
			mapRegionLabel: 'Map showing Parish Council consultees for Longfield Solar Farm',
			staticMapSrc:
				'/consultees/11111111-1111-1111-1111-111111111111/results/static-map?ruleset=england-wales-post-20240430&category=Parish%20Council',
			staticMapAlt: 'Static map showing Parish Council consultees for Longfield Solar Farm',
			mapWidth: 900,
			mapHeight: 506,
			mapConfigJson: '{"type":"FeatureCollection","features":[]}',
			removedRows: [{ name: 'Little Bedwyn Parish Council', reason: 'Outside the search area' }],
			removedOpen: true,
			rulesetFailed: false,
			retryUrl:
				'/consultees/11111111-1111-1111-1111-111111111111/report/consultees?ruleset=england-wales-post-20240430&category=Parish%20Council'
		});
		assert.match(html, /Removed consultees/);
		assert.match(html, /Outside the search area/);
		await assertNoSeriousA11yViolations(html);
	});

	test('report consultees change page with no remaining consultees has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultees/report/consultees/view.njk', {
			...pageLocals,
			pageHeading: 'Parish Council',
			pageCaption: 'Longfield Solar Farm',
			backLinkUrl: '/consultees/11111111-1111-1111-1111-111111111111/report?ruleset=england-wales-post-20240430',
			rows: [],
			addConsulteeUrl:
				'/consultees/11111111-1111-1111-1111-111111111111/report/consultees/add?ruleset=england-wales-post-20240430&category=Parish%20Council',
			saveAndReturnUrl: '/consultees/11111111-1111-1111-1111-111111111111/report?ruleset=england-wales-post-20240430',
			mapId: 'case-map',
			mapRegionLabel: 'Map showing Parish Council consultees for Longfield Solar Farm',
			staticMapSrc:
				'/consultees/11111111-1111-1111-1111-111111111111/results/static-map?ruleset=england-wales-post-20240430&category=Parish%20Council',
			staticMapAlt: 'Static map showing Parish Council consultees for Longfield Solar Farm',
			mapWidth: 900,
			mapHeight: 506,
			mapConfigJson: '{"type":"FeatureCollection","features":[]}',
			removedRows: [],
			removedOpen: false,
			rulesetFailed: false,
			retryUrl:
				'/consultees/11111111-1111-1111-1111-111111111111/report/consultees?ruleset=england-wales-post-20240430&category=Parish%20Council'
		});
		assert.match(html, /No consultees identified in this category/);
		await assertNoSeriousA11yViolations(html);
	});

	test('add a consultee page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultees/report/consultees/add/view.njk', {
			...pageLocals,
			pageHeading: 'Add a consultee',
			pageCaption: 'Parish Council',
			backLinkUrl:
				'/consultees/11111111-1111-1111-1111-111111111111/report/consultees?ruleset=england-wales-post-20240430&category=Parish%20Council',
			formAction:
				'/consultees/11111111-1111-1111-1111-111111111111/report/consultees/add?ruleset=england-wales-post-20240430&category=Parish%20Council',
			nearbySuggestions: [
				{ name: 'Great Snoring Parish Council', hint: '1.3 km from the site' },
				{ name: 'Barton', hint: '4.0 km from the site' }
			],
			addForm: { nameValue: '', reasonValue: '' }
		});
		assert.match(html, /<datalist id="nearby-consultees">/);
		await assertNoSeriousA11yViolations(html);
	});

	test('add a consultee page in its error state has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultees/report/consultees/add/view.njk', {
			...pageLocals,
			pageHeading: 'Add a consultee',
			pageCaption: 'Parish Council',
			backLinkUrl:
				'/consultees/11111111-1111-1111-1111-111111111111/report/consultees?ruleset=england-wales-post-20240430&category=Parish%20Council',
			formAction:
				'/consultees/11111111-1111-1111-1111-111111111111/report/consultees/add?ruleset=england-wales-post-20240430&category=Parish%20Council',
			nearbySuggestions: [],
			addForm: {
				nameValue: '',
				reasonValue: '',
				nameError: { text: 'Enter the consultee name' },
				reasonError: { text: 'Enter a reason for adding this consultee' }
			},
			errorSummary: [
				{ text: 'Enter the consultee name', href: '#consultee-name' },
				{ text: 'Enter a reason for adding this consultee', href: '#consultee-reason' }
			]
		});
		assert.match(html, /There is a problem/);
		await assertNoSeriousA11yViolations(html);
	});

	test('remove consultee page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultees/report/consultees/remove/view.njk', {
			...pageLocals,
			pageHeading: 'Remove consultee',
			pageCaption: 'Longfield Solar Farm',
			backLinkUrl:
				'/consultees/11111111-1111-1111-1111-111111111111/report/consultees?ruleset=england-wales-post-20240430&category=Parish%20Council',
			formAction:
				'/consultees/11111111-1111-1111-1111-111111111111/report/consultees/remove?ruleset=england-wales-post-20240430&category=Parish%20Council&match=55555555-5555-5555-5555-555555555555',
			name: 'Little Snoring Parish Council',
			identified: ['"B" host Parishes or Community Councils: intersects the site'],
			reasonValue: '',
			rulesetFailed: false,
			retryUrl:
				'/consultees/11111111-1111-1111-1111-111111111111/report/consultees/remove?ruleset=england-wales-post-20240430&category=Parish%20Council&match=55555555-5555-5555-5555-555555555555'
		});
		assert.match(html, /Reason for removing/);
		await assertNoSeriousA11yViolations(html);
	});

	test('remove consultee page in its error state has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultees/report/consultees/remove/view.njk', {
			...pageLocals,
			pageHeading: 'Remove consultee',
			pageCaption: 'Longfield Solar Farm',
			backLinkUrl:
				'/consultees/11111111-1111-1111-1111-111111111111/report/consultees?ruleset=england-wales-post-20240430&category=Parish%20Council',
			formAction:
				'/consultees/11111111-1111-1111-1111-111111111111/report/consultees/remove?ruleset=england-wales-post-20240430&category=Parish%20Council&match=55555555-5555-5555-5555-555555555555',
			name: 'Little Snoring Parish Council',
			identified: ['"B" host Parishes or Community Councils: intersects the site'],
			reasonValue: '   ',
			reasonError: { text: 'Enter a reason for removing this consultee' },
			errorSummary: [{ text: 'Enter a reason for removing this consultee', href: '#removal-reason' }],
			rulesetFailed: false,
			retryUrl:
				'/consultees/11111111-1111-1111-1111-111111111111/report/consultees/remove?ruleset=england-wales-post-20240430&category=Parish%20Council&match=55555555-5555-5555-5555-555555555555'
		});
		assert.match(html, /There is a problem/);
		await assertNoSeriousA11yViolations(html);
	});

	test('report created page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultees/report/created.njk', {
			...pageLocals,
			pageHeading: 'Report created',
			backLinkUrl: '/consultees/11111111-1111-1111-1111-111111111111?ruleset=england-wales-post-20240430',
			caseName: 'Longfield Solar Farm',
			reference: 'EN0110007',
			downloadUrl:
				'/consultees/11111111-1111-1111-1111-111111111111/report/download?ruleset=england-wales-post-20240430',
			downloadText: 'Download Longfield Solar Farm Consultee List report (ZIP, 25MB)',
			rulesetFailed: false,
			retryUrl: '/consultees/11111111-1111-1111-1111-111111111111/report/created?ruleset=england-wales-post-20240430'
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('report created page when the ruleset could not be run has no serious a11y violations', async () => {
		const html = nunjucks.render('views/consultees/report/created.njk', {
			...pageLocals,
			pageHeading: 'Report created',
			backLinkUrl: '/consultees/11111111-1111-1111-1111-111111111111?ruleset=england-wales-post-20240430',
			caseName: 'Longfield Solar Farm',
			reference: 'EN0110007',
			downloadUrl:
				'/consultees/11111111-1111-1111-1111-111111111111/report/download?ruleset=england-wales-post-20240430',
			downloadText: 'Download Longfield Solar Farm Consultee List report (ZIP)',
			rulesetFailed: true,
			retryUrl: '/consultees/11111111-1111-1111-1111-111111111111/report/created?ruleset=england-wales-post-20240430'
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

	for (const [view, pageHeading] of [
		['views/footer/terms-and-conditions.njk', 'Terms and conditions'],
		['views/footer/accessibility-statement.njk', 'Accessibility statement for Identify consultees'],
		['views/footer/cookies.njk', 'Cookies'],
		['views/footer/contact.njk', 'Contact us']
	] as const) {
		test(`${pageHeading} footer page has no serious a11y violations`, async () => {
			const html = nunjucks.render(view, {
				...pageLocals,
				pageHeading
			});
			await assertNoSeriousA11yViolations(html);
		});
	}

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
					sourceId: 'health_AMB_EW_00001',
					consulteeCategory: 'Statutory',
					consulteeGroup: 'Health',
					consultee: 'Example Trust',
					region: 'South West',
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
