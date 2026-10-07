import { expect, test } from '@playwright/test';
import { SAMPLE_CASE_ID, SAMPLE_CASE_NAME, SAMPLE_CASE_REFERENCE, SAMPLE_RULESET_NAME } from './fixtures.ts';

test.describe('manage journeys', () => {
	test('home page shows identify consultees search', async ({ page }) => {
		await page.goto(`/?q=${SAMPLE_CASE_REFERENCE}`);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Identify consultees for a NSIP project');
		await expect(page.getByText(SAMPLE_CASE_NAME).first()).toBeVisible();
	});

	test('home page respects results per page', async ({ page }) => {
		await page.goto('/?pageSize=50');
		// real seed data has fewer than 50 case boundaries, so "to" is capped at however many
		// actually matched - just confirm the requested page size took effect
		await expect(page.getByText(/Showing 1 to \d+ of \d+ results/)).toBeVisible();
		await expect(
			page.locator('.govuk-body', { hasText: 'Results per page' }).getByText('50', { exact: true })
		).toBeVisible();
	});

	test('choosing a project then a ruleset runs it and shows the results', async ({ page }) => {
		await page.goto(`/?q=${SAMPLE_CASE_REFERENCE}`);
		// a caseReference isn't guaranteed unique (a project can have several boundary submissions),
		// so follow the link by its href (a specific case id) rather than by its visible text
		await page.locator(`a[href="/consultees/${SAMPLE_CASE_ID}"]`).click();

		await expect(page.getByRole('heading', { level: 1 })).toContainText('Choose a ruleset');
		await page.getByLabel('Ruleset').selectOption({ label: SAMPLE_RULESET_NAME });
		await page.getByRole('button', { name: 'Run ruleset' }).click();

		await expect(page.getByRole('heading', { level: 1 })).toContainText('Consultees identified for');
		await expect(page.getByText(`Ruleset used: ${SAMPLE_RULESET_NAME}`)).toBeVisible();
		await expect(page.getByRole('heading', { level: 2, name: 'Consultees identified' })).toBeVisible();
	});

	test('a direct link to the ruleset picker page works', async ({ page }) => {
		await page.goto(`/consultees/${SAMPLE_CASE_ID}`);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Choose a ruleset');
		await expect(page.getByText(SAMPLE_CASE_NAME)).toBeVisible();
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
