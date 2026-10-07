import { expect, test } from '@playwright/test';
import {
	SAMPLE_CASE_ID,
	SAMPLE_CASE_NAME,
	SAMPLE_CASE_REFERENCE,
	SAMPLE_RULESET_ID,
	SAMPLE_RULESET_NAME
} from './fixtures.ts';

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
		name: 'ruleset picker',
		heading: /Choose a ruleset/i,
		// the ruleset options themselves live inside a <select> - not "visible" text in the
		// getByText sense - so check the visible label instead
		mustSee: [/Ruleset/i]
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

			// PINS chrome: generic header + service navigation + footer
			await expect(page.locator('.govuk-generic-header, .pins-header').first()).toBeVisible();
			await expect(page.locator('.govuk-service-navigation, .pins-service-navigation').first()).toBeVisible();
			await expect(page.locator('footer').first()).toBeVisible();

			if (pageCase.heading) {
				await expect(page.getByRole('heading', { level: 1 })).toContainText(pageCase.heading);
			} else {
				await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			}

			for (const text of pageCase.mustSee) {
				await expect(page.getByText(text).first()).toBeVisible();
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

		const mapRegion = page.locator('[data-consultee-map].app-case-map').first();
		await expect(mapRegion).toBeAttached();
		await expect(mapRegion).toHaveAttribute('role', 'region');
		await expect(mapRegion).toHaveAttribute('data-map-width', '960');
		await expect(mapRegion).toHaveAttribute('data-map-height', '516');
		await expect(mapRegion).toHaveAttribute('data-static-map-src', /\/static-map/);
		await expect(mapRegion).toHaveAttribute('aria-label', new RegExp(SAMPLE_RULESET_NAME, 'i'));
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
		const host = page.locator('[data-map-layers-demo].app-case-map');
		await expect(host).toBeAttached();
		await expect(host).toHaveAttribute('role', 'region');
		await expect(host).toHaveAttribute('data-map-width', '960');
		await expect(host).toHaveAttribute('data-map-height', '516');
		await expect(host).toHaveAttribute('aria-label', /overlay layers/i);
		await expect(page.locator('#map-layers-demo-data')).toBeAttached();
	});
});
