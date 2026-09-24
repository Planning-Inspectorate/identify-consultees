import { expect, test } from '@playwright/test';

test.describe('manage journeys', () => {
	test('home page shows identify consultees search', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { level: 1 })).toContainText(
			'Identify consultees for an infrastructure project'
		);
		await expect(page.getByLabel(/Choose a ruleset/i)).toBeVisible();
		await expect(page.getByText('Gwynt Glas Offshore Wind Farm').first()).toBeVisible();
	});

	test('home page respects results per page', async ({ page }) => {
		await page.goto('/?pageSize=50');
		await expect(page.getByText(/Showing 1 to 50 of/)).toBeVisible();
	});

	test('consultees results page shows sections and map regions', async ({ page }) => {
		await page.goto('/consultees/geo-1');
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Consultees identified for');
		await expect(page.getByRole('heading', { level: 2, name: /Ambulance Trusts/i })).toBeVisible();
		await expect(page.getByRole('heading', { level: 2, name: /Police Force Areas/i })).toBeVisible();
	});

	test('map layers demo page renders layer summaries', async ({ page }) => {
		await page.goto('/map-layers-demo');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Map layers demo');
		await expect(page.getByRole('rowheader', { name: 'Railway lines' })).toBeVisible();
		await expect(page.getByRole('rowheader', { name: 'Road network' })).toBeVisible();
		await expect(page.locator('[data-map-layers-demo]')).toBeVisible();
	});

	test('signed-out page offers sign in again', async ({ page }) => {
		await page.goto('/signed-out');
		await expect(page.getByText('You have signed out').first()).toBeVisible();
		await expect(
			page.getByRole('link', { name: 'Sign in again' }).or(page.getByRole('button', { name: 'Sign in again' }))
		).toBeVisible();
	});

	test('unknown routes render the GOV.UK 404 page', async ({ page }) => {
		await page.goto('/this-page-does-not-exist');
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Page not found');
	});

	test('items list example page renders', async ({ page }) => {
		await page.goto('/items');
		await expect(page.locator('main')).toBeVisible();
	});
});
