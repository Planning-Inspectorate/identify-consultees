import { expect, test } from '@playwright/test';

/**
 * Visual regression baselines for key manage pages.
 *
 * Scaffolded for later use — not run by `npm test` while the UI is still
 * changing heavily. Run intentionally with:
 *
 *   npm run test:visual
 *   npm run test:visual -- --update-snapshots
 */
test.describe('visual regression @visual', () => {
	test('home page', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveScreenshot('home.png', { fullPage: true });
	});

	test('consultees results page', async ({ page }) => {
		await page.goto('/consultees/geo-1');
		await expect(page).toHaveScreenshot('consultees-results.png', { fullPage: true });
	});

	test('map layers demo page', async ({ page }) => {
		await page.goto('/map-layers-demo');
		await expect(page).toHaveScreenshot('map-layers-demo.png', { fullPage: true });
	});

	test('signed out page', async ({ page }) => {
		await page.goto('/signed-out');
		await expect(page).toHaveScreenshot('signed-out.png', { fullPage: true });
	});
});
