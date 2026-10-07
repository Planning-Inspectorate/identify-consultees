import { newDatabaseClient } from '@pins/identify-consultees-database';
import { expect, test } from '@playwright/test';
import { loadCaseBoundaries } from '../../../packages/database/src/geospatial/case-boundaries.ts';
import {
	SAMPLE_CASE_ID,
	SAMPLE_CASE_NAME,
	SAMPLE_CASE_REFERENCE,
	SAMPLE_RULESET_ID,
	SAMPLE_RULESET_NAME
} from './fixtures.ts';

// same fallback the e2e server resolves - see buildManageTestConfig's database.connectionString
const connectionString =
	process.env.SQL_CONNECTION_STRING ??
	'sqlserver://localhost:1434;database=identify-consultees;user=sa;password=DockerDatabaseP@22word!;trustServerCertificate=true';

const E2E_PAGE_PREFIX = 'E2EPAGE';
const E2E_PAGE_ROWS = 26; // one more than the smallest page size, so the filtered set spans two pages

function e2ePageFeatures() {
	return Array.from({ length: E2E_PAGE_ROWS }, (_, i) => {
		const n = String(i + 1).padStart(3, '0');
		return {
			id: `e2e00000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
			type: 'Feature' as const,
			geometry: { type: 'Point' as const, coordinates: [0, 0] },
			properties: { caseReference: `${E2E_PAGE_PREFIX}${n}`, caseName: `E2E Page ${n}` }
		};
	});
}

async function deleteE2ePageRows(db: ReturnType<typeof newDatabaseClient>) {
	await db.$executeRaw`DELETE FROM case_boundary WHERE caseReference LIKE ${E2E_PAGE_PREFIX + '%'}`;
}

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

	test('home search paginates when results exceed one page', async ({ page }) => {
		// the fixed seed holds exactly one page of boundaries, so add a temporary set that pushes
		// the filtered result count past it regardless of what else the environment contains
		const db = newDatabaseClient(connectionString);
		try {
			await deleteE2ePageRows(db);
			await loadCaseBoundaries(db, { type: 'FeatureCollection', features: e2ePageFeatures() });

			await page.goto(`/?q=${E2E_PAGE_PREFIX}&pageSize=25`);
			await expect(page.getByText(`Showing 1 to 25 of ${E2E_PAGE_ROWS} results`)).toBeVisible();
			await expect(page.getByRole('navigation', { name: 'Pagination' })).toBeVisible();

			await page.getByRole('link', { name: 'Page 2', exact: true }).click();
			await expect(page).toHaveURL(/page=2/);
			await expect(page.getByText('Showing 26 to 26 of 26 results')).toBeVisible();
			await expect(page.getByRole('link', { name: `${E2E_PAGE_PREFIX}026 - E2E Page 026` })).toBeVisible();

			await page.getByRole('link', { name: 'Previous page' }).click();
			await expect(page).toHaveURL(/page=1/);
			await expect(page.getByText(`Showing 1 to 25 of ${E2E_PAGE_ROWS} results`)).toBeVisible();
		} finally {
			await deleteE2ePageRows(db);
			await db.$disconnect();
		}
	});

	test('choosing a project shows its map page, and changing the ruleset returns to it', async ({ page }) => {
		await page.goto(`/?q=${SAMPLE_CASE_REFERENCE}`);
		// a caseReference isn't guaranteed unique (a project can have several boundary submissions),
		// so follow the link by its href (a specific case id) rather than by its visible text
		await page.locator(`a[href="/consultees/${SAMPLE_CASE_ID}"]`).click();

		// the map page runs the default ruleset straight away
		await expect(page.getByRole('heading', { level: 1 })).toContainText(SAMPLE_CASE_NAME);
		await expect(page.getByRole('button', { name: 'Preview report' })).toBeVisible();

		// "Change" (ruleset) -> radios page -> "Save and return" brings the choice back to the map
		await page.getByRole('link', { name: 'Change ruleset' }).click();
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Ruleset');
		await page.getByRole('radio', { name: SAMPLE_RULESET_NAME }).check();
		await page.getByRole('button', { name: 'Save and return' }).click();

		await expect(page).toHaveURL(new RegExp(`/consultees/${SAMPLE_CASE_ID}\\?ruleset=${SAMPLE_RULESET_ID}`));
		await expect(page.getByRole('heading', { level: 1 })).toContainText(SAMPLE_CASE_NAME);

		// "Preview report" leads to the check page for the same selection
		await page.getByRole('button', { name: 'Preview report' }).click();
		await expect(page).toHaveURL(new RegExp(`/consultees/${SAMPLE_CASE_ID}/report\\?ruleset=${SAMPLE_RULESET_ID}`));
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Check consultees before creating the report');

		// a category's "Change" opens its shared consultees page: the map above its rows, each with
		// a Remove link - and the check page's count is exactly the number of rows listed
		const parishChange = page.getByRole('link', { name: 'Change Parish Council' });
		const parishCount = Number(
			(
				await page
					.locator('.govuk-summary-list__row', { has: parishChange })
					.locator('.govuk-summary-list__value')
					.innerText()
			).trim()
		);
		await parishChange.click();

		await expect(page).toHaveURL(/\/report\/consultees\?.*category=Parish/);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Parish Council');
		await expect(page.getByRole('heading', { level: 2, name: 'Consultees' })).toBeVisible();
		const removeLinks = page.getByRole('link', { name: /Remove/ });
		await expect(removeLinks).toHaveCount(parishCount);

		// removing a consultee reloads the page with it excluded, so the table drops a row
		let removed = 0;
		if (parishCount > 0) {
			await removeLinks.first().click();
			await expect(page).toHaveURL(/exclude=/);
			await expect(page.getByRole('link', { name: /Remove/ })).toHaveCount(parishCount - 1);
			removed = 1;
		}

		// "Add consultee" opens its form - a blank name fails validation with the entered reason kept
		await page.getByRole('button', { name: 'Add consultee' }).click();
		await expect(page).toHaveURL(/\/report\/consultees\/add\?.*category=Parish/);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Select a consultee');
		await page.getByLabel('Reason for identification').fill('Entered first');
		await page.getByRole('button', { name: 'Add consultee' }).click();
		await expect(page.getByText('There is a problem')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Enter the consultee name' })).toBeVisible();
		await expect(page.getByText('Error: Enter the consultee name')).toBeVisible();
		await expect(page.getByLabel('Reason for identification')).toHaveValue('Entered first');

		// saving a consultee returns to the category page with it listed below the map - and any
		// number can be added one at a time
		await page.getByLabel('Name of consultee').fill('First Test Consultee');
		await page.getByRole('button', { name: 'Add consultee' }).click();
		await expect(page).toHaveURL(/\/report\/consultees\?.*category=Parish.*add=/);
		await expect(page.getByRole('rowheader', { name: 'First Test Consultee' })).toBeVisible();
		await expect(page.getByText('Entered first')).toBeVisible();

		await page.getByRole('button', { name: 'Add consultee' }).click();
		await page.getByLabel('Name of consultee').fill('Second Test Consultee');
		await page.getByRole('button', { name: 'Add consultee' }).click();
		await expect(page.getByRole('rowheader', { name: 'Second Test Consultee' })).toBeVisible();
		await expect(page.getByText('Manually added')).toBeVisible();
		await expect(page.getByRole('link', { name: /Remove/ })).toHaveCount(parishCount - removed + 2);

		// a hand-added consultee's Remove link drops just that row
		await page.getByRole('link', { name: 'Remove Second Test Consultee' }).click();
		await expect(page.getByRole('rowheader', { name: 'Second Test Consultee' })).toHaveCount(0);
		await expect(page.getByRole('rowheader', { name: 'First Test Consultee' })).toBeVisible();
		await expect(page.getByRole('link', { name: /Remove/ })).toHaveCount(parishCount - removed + 1);

		// "Save and return" lands back on the check page, its count matching the rows just listed
		await page.getByRole('button', { name: 'Save and return' }).click();
		await expect(page).toHaveURL(new RegExp(`/consultees/${SAMPLE_CASE_ID}/report\\?ruleset=${SAMPLE_RULESET_ID}`));
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Check consultees before creating the report');
		await expect(
			page
				.locator('.govuk-summary-list__row', { hasText: 'Parish Council' })
				.locator('.govuk-summary-list__value')
				.first()
		).toHaveText(String(parishCount - removed + 1));

		// "Generate report" leads to the confirmation page with the download link
		await page.getByRole('button', { name: 'Generate report' }).click();
		await expect(page).toHaveURL(
			new RegExp(`/consultees/${SAMPLE_CASE_ID}/report/created\\?ruleset=${SAMPLE_RULESET_ID}`)
		);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Report created');
		await expect(
			page.getByRole('link', { name: new RegExp(`Download ${SAMPLE_CASE_NAME} scoping report`) })
		).toBeVisible();

		// the same selection's report page still lists the matched consultees
		await page.goto(`/consultees/${SAMPLE_CASE_ID}/results?ruleset=${SAMPLE_RULESET_ID}`);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Consultees identified for');
		await expect(page.getByText(`Ruleset used: ${SAMPLE_RULESET_NAME}`)).toBeVisible();
		await expect(page.getByRole('heading', { level: 2, name: 'Consultees identified' })).toBeVisible();
	});

	test('the shapefile change page lists the project’s files and returns on save', async ({ page }) => {
		await page.goto(`/consultees/${SAMPLE_CASE_ID}/shapefile?ruleset=${SAMPLE_RULESET_ID}`);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Project shapefile');

		await page.getByRole('radio').first().check();
		await page.getByRole('button', { name: 'Save and return' }).click();
		await expect(page).toHaveURL(/\/consultees\/[0-9a-f-]{36}\?ruleset=/);
	});

	test('a direct link to the project map page works', async ({ page }) => {
		await page.goto(`/consultees/${SAMPLE_CASE_ID}`);
		await expect(page.getByRole('heading', { level: 1 })).toContainText(SAMPLE_CASE_NAME);
		await expect(page.getByRole('link', { name: 'Back to projects' })).toBeVisible();
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
