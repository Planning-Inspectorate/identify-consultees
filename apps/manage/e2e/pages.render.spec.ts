import { expect, test } from '@playwright/test';

/**
 * Cross-browser render completeness checks (Firefox + WebKit/Safari).
 *
 * These assert that key pages paint critical GOV.UK structure and content in
 * engines beyond Chromium — headings, landmarks, and primary UI — without
 * depending on Chromium-only behaviour.
 */
const pages = [
	{
		path: '/',
		name: 'home',
		heading: /Identify consultees for an infrastructure project/i,
		mustSee: [/Choose a ruleset/i, /Gwynt Glas Offshore Wind Farm/i]
	},
	{
		path: '/consultees/geo-1',
		name: 'consultees results',
		heading: /Consultees identified for/i,
		mustSee: [/Ambulance Trusts/i, /Police Force Areas/i]
	},
	{
		path: '/map-layers-demo',
		name: 'map layers demo',
		heading: /Map layers demo/i,
		mustSee: [/Railway lines/i, /Road network/i]
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
			const response = await page.goto(pageCase.path);
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

	test('consultees results exposes map section regions', async ({ page }) => {
		await page.goto('/consultees/geo-1');
		await expect(page.getByRole('heading', { level: 2, name: /Ambulance Trusts/i })).toBeVisible();

		const mapRegion = page.locator('[data-consultee-map].app-case-map').first();
		await expect(mapRegion).toBeAttached();
		await expect(mapRegion).toHaveAttribute('role', 'region');
		await expect(mapRegion).toHaveAttribute('data-map-width', '960');
		await expect(mapRegion).toHaveAttribute('data-map-height', '516');
		await expect(mapRegion).toHaveAttribute('data-static-map-src', /\/static-map$/);
		await expect(mapRegion).toHaveAttribute('aria-label', /Ambulance Trust/i);
	});

	test('map layers demo host is present for progressive enhancement', async ({ page }) => {
		await page.goto('/map-layers-demo');
		const host = page.locator('[data-map-layers-demo].app-case-map');
		await expect(host).toBeAttached();
		await expect(host).toHaveAttribute('role', 'region');
		await expect(host).toHaveAttribute('data-map-width', '960');
		await expect(host).toHaveAttribute('data-map-height', '516');
		await expect(host).toHaveAttribute('aria-label', /overlay layers/i);
		await expect(page.locator('#map-layers-demo-data')).toBeAttached();
	});
});
