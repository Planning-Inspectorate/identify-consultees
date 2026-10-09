import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
	SAMPLE_CASE_ID,
	SAMPLE_CASE_NAME,
	SAMPLE_CASE_REFERENCE,
	SAMPLE_RULESET_ID,
	SAMPLE_RULESET_NAME
} from './fixtures.ts';

/**
 * The opening tag of the element with `className`, as the server sent it. The live DOM won't do:
 * the map adds its own data-breakpoint to the container once it starts, so whether it's there
 * depends on how fast the map loaded.
 */
async function serverRenderedOpeningTag(page: Page, path: string, className: string): Promise<string> {
	const html = await (await page.request.get(path)).text();
	const tag = html.match(new RegExp(`<[a-z]+\\s[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`))?.[0];
	expect(tag, `no element with class ${className} in ${path}`).toBeDefined();
	return tag ?? '';
}

/**
 * Cross-browser render completeness checks (Firefox + WebKit/Safari).
 *
 * These assert that key pages paint critical GOV.UK structure and content in
 * engines beyond Chromium — headings, landmarks, and primary UI — without
 * depending on Chromium-only behaviour.
 */
const pages = [
	{
		path: `/?q=${SAMPLE_CASE_REFERENCE}`,
		name: 'home',
		heading: /Identify consultees for a NSIP project/i,
		mustSee: [new RegExp(SAMPLE_CASE_NAME, 'i')]
	},
	{
		path: `/consultees/${SAMPLE_CASE_ID}`,
		name: 'project boundary',
		heading: /Project boundary/i,
		mustSee: [/Back to projects/i, /Confirm shapefile for report/i, /Continue/i]
	},
	{
		path: `/consultees/${SAMPLE_CASE_ID}/ruleset`,
		name: 'ruleset picker',
		heading: /Ruleset/i,
		mustSee: [new RegExp(SAMPLE_RULESET_NAME, 'i'), /Identify consultees/i]
	},
	{
		path: `/consultees/${SAMPLE_CASE_ID}/report?ruleset=${SAMPLE_RULESET_ID}`,
		name: 'report check',
		heading: /Check consultees before creating the report/i,
		mustSee: [/Report details/i, /Identified consultees/i, /Create report/i, /Shapefile/i]
	},
	{
		path: `/consultees/${SAMPLE_CASE_ID}/report/consultees?ruleset=${SAMPLE_RULESET_ID}&category=Parish%20Council`,
		name: 'report consultees',
		heading: /Parish Council/i,
		mustSee: [/Consultees/i, /Add consultee/i, /Save and return/i]
	},
	{
		path: `/consultees/${SAMPLE_CASE_ID}/report/consultees/add?ruleset=${SAMPLE_RULESET_ID}&category=Parish%20Council`,
		name: 'report consultee add',
		heading: /Select a consultee/i,
		mustSee: [/Name of consultee/i, /Reason for identification/i, /Add consultee/i]
	},
	{
		path: `/consultees/${SAMPLE_CASE_ID}/report/created?ruleset=${SAMPLE_RULESET_ID}`,
		name: 'report created',
		heading: /Report created/i,
		mustSee: [/scoping report/i]
	},
	{
		path: `/consultees/${SAMPLE_CASE_ID}/results?ruleset=${SAMPLE_RULESET_ID}`,
		name: 'consultees results',
		heading: /Consultees identified for/i,
		mustSee: [new RegExp(`Ruleset used: ${SAMPLE_RULESET_NAME}`, 'i')]
	},
	{
		path: '/map-layers-demo',
		name: 'map layers demo',
		heading: /Map layers demo/i,
		mustSee: [/Railway lines/i, /Road network/i]
	},
	{
		path: '/components?components=true',
		name: 'components index',
		heading: /GOV.UK Frontend components/i,
		mustSee: [/Accordion/i, /Warning text/i, /Components/i]
	},
	{
		path: '/components/tag?components=true',
		name: 'component detail',
		heading: /Tag/i,
		mustSee: [/default/i]
	},
	{
		path: '/components/interactive-map?components=true',
		name: 'interactive map examples index',
		heading: /Interactive map/i,
		mustSee: [/Basic map/i, /Style switcher/i]
	},
	{
		path: '/components/interactive-map/polygons?components=true',
		name: 'interactive map example',
		heading: /Polygon overlay/i,
		mustSee: [/About this example/i]
	},
	{
		path: '/signed-out',
		name: 'signed out',
		heading: /You have signed out/i,
		mustSee: [/Sign in again/i]
	},
	{
		path: '/terms-and-conditions',
		name: 'terms and conditions',
		heading: /Terms and conditions/i,
		mustSee: [/Who we are/i, /Governing law/i]
	},
	{
		path: '/accessibility-statement',
		name: 'accessibility statement',
		heading: /Accessibility statement for Identify consultees/i,
		mustSee: [/How accessible this website is/i, /Enforcement procedure/i]
	},
	{
		path: '/cookies',
		name: 'cookies',
		heading: /Cookies/i,
		mustSee: [/Strictly necessary cookies/i]
	},
	{
		path: '/contact',
		name: 'contact',
		heading: /Contact us/i,
		mustSee: [/General enquiries/i, /0303 444 5000/i, /Planning Inspectorate/i]
	},
	{
		path: '/items',
		name: 'items list',
		heading: null,
		mustSee: []
	},
	{
		path: '/this-page-does-not-exist',
		name: '404',
		heading: /Page not found/i,
		mustSee: []
	},
	{
		path: '/error/firewall-error',
		name: 'firewall error',
		heading: /Sorry, there is a problem with the service/i,
		mustSee: []
	}
] as const;

test.describe('cross-browser render completeness', () => {
	for (const pageCase of pages) {
		test(`${pageCase.name} renders primary content`, async ({ page }, testInfo) => {
			// 'load' is deliberately avoided: Firefox intermittently never reports it to
			// Playwright under parallel load even when the page (and all subresources)
			// have finished - the assertions below only need the DOM anyway.
			const response = await page.goto(pageCase.path, { waitUntil: 'domcontentloaded' });
			expect(response, 'navigation should return a response').not.toBeNull();
			expect(response!.ok() || response!.status() === 404).toBeTruthy();

			const main = page.locator('#main-content, main').first();
			await expect(main).toBeVisible();

			// PINS chrome: header + service navigation + footer
			await expect(page.locator('.pins-header').first()).toBeVisible();
			await expect(page.locator('.govuk-service-navigation, .pins-service-navigation').first()).toBeVisible();
			await expect(page.locator('footer').first()).toBeVisible();

			if (pageCase.heading) {
				await expect(page.getByRole('heading', { level: 1 })).toContainText(pageCase.heading);
			} else {
				await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			}

			for (const text of pageCase.mustSee) {
				// filter to visible matches - hidden metadata (e.g. the header logo's
				// SVG <title>) can share the same text and is never visible
				await expect(page.getByText(text).filter({ visible: true }).first()).toBeVisible();
			}

			// Main content should occupy space (guards against blank/collapsed renders)
			const box = await main.boundingBox();
			expect(box, 'main landmark should have a layout box').not.toBeNull();
			expect(box!.height).toBeGreaterThan(40);
			expect(box!.width).toBeGreaterThan(200);

			await testInfo.attach(`render-${pageCase.name}-${testInfo.project.name}`, {
				body: await main.innerHTML(),
				contentType: 'text/html'
			});
		});
	}

	test('consultees results exposes a map region', async ({ page }) => {
		await page.goto(`/consultees/${SAMPLE_CASE_ID}/results?ruleset=${SAMPLE_RULESET_ID}`, {
			waitUntil: 'domcontentloaded'
		});
		await expect(page.getByRole('heading', { level: 2, name: /Consultees identified/i })).toBeVisible();

		const mapRegion = page.locator('.app-consultee-map.app-case-map').first();
		await expect(mapRegion).toBeAttached();
		await expect(mapRegion).toHaveAttribute('role', 'region');
		await expect(mapRegion).toHaveAttribute('aria-label', new RegExp(SAMPLE_RULESET_NAME, 'i'));

		// the static-map fallback travels in the page config - data-* attributes on the map
		// container are JSON.parsed by the InteractiveMap constructor and must stay off it
		expect(
			await serverRenderedOpeningTag(
				page,
				`/consultees/${SAMPLE_CASE_ID}/results?ruleset=${SAMPLE_RULESET_ID}`,
				'app-consultee-map'
			)
		).not.toMatch(/\sdata-/);
		const config = JSON.parse((await page.locator('#case-map-data').textContent()) ?? '{}');
		expect(config.fallback.src).toMatch(/\/static-map/);
		expect(config.fallback.width).toBe(960);
		expect(config.fallback.height).toBe(516);
	});

	test('interactive map example host is present for progressive enhancement', async ({ page }) => {
		await page.goto('/components/interactive-map/basic?components=true', { waitUntil: 'domcontentloaded' });
		const host = page.locator('.app-interactive-map-example.app-case-map');
		await expect(host).toBeAttached();
		await expect(host).toHaveAttribute('role', 'region');
		await expect(host).toHaveAttribute('aria-label', /.+/);
		// the noscript fallback carries the heavily-cached static map — assert on
		// the raw HTML since noscript children never enter the DOM under JS
		const html = await (await page.request.get('/components/interactive-map/basic?components=true')).text();
		expect(html).toContain('<noscript>');
		expect(html).toContain('src="/components/interactive-map/basic/static-map"');
		// the page config block feeds the client module (including the fallback details)
		const configJson = await page.locator('#interactive-map-example-basic-data').textContent();
		expect(JSON.parse(configJson).fallback.src).toBe('/components/interactive-map/basic/static-map');
	});

	test('map layers demo host is present for progressive enhancement', async ({ page }) => {
		await page.goto('/map-layers-demo', { waitUntil: 'domcontentloaded' });
		const host = page.locator('.app-map-layers-demo.app-case-map');
		await expect(host).toBeAttached();
		await expect(host).toHaveAttribute('role', 'region');
		await expect(host).toHaveAttribute('aria-label', /overlay layers/i);
		expect(await serverRenderedOpeningTag(page, '/map-layers-demo', 'app-map-layers-demo')).not.toMatch(/\sdata-/);
		await expect(page.locator('#map-layers-demo-data')).toBeAttached();
	});
});
