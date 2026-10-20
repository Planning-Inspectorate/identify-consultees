import { newDatabaseClient } from '@pins/identify-consultees-database';
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFile } from 'node:fs/promises';
import { loadCaseBoundaries } from '../../../packages/database/src/geospatial/case-boundaries.ts';
import { loadConsulteeAreas } from '../../../packages/database/src/geospatial/consultee-areas.ts';
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

// the consultees the journey adds by hand - the add page only takes names that are consultees in
// the reference data. Far from the sample case (Shetland), so they're never its nearby consultees
const E2E_ADDED_CONSULTEES = ['First Test Consultee', 'Second Test Consultee'].map((consultee, i) => ({
	id: `e2e00000-0000-0000-0001-${String(i + 1).padStart(12, '0')}`,
	type: 'Feature' as const,
	geometry: { type: 'Point' as const, coordinates: [-1.3, 60.3 + i * 0.01] },
	properties: { consulteeCategory: 'Parish Council', consultee }
}));

const JOURNEY_TITLE = 'choosing a project starts the boundary-ruleset-check journey';

async function deleteE2eAddedConsultees(db: ReturnType<typeof newDatabaseClient>) {
	for (const { id } of E2E_ADDED_CONSULTEES) {
		await db.$executeRaw`DELETE FROM consultee_area WHERE id = ${id}`;
	}
}

test.describe('manage journeys', () => {
	test('home page shows identify consultees search', async ({ page }) => {
		await page.goto(`/?q=${SAMPLE_CASE_REFERENCE}`);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Identify consultees for a NSIP project');
		await expect(page.getByText(SAMPLE_CASE_NAME).first()).toBeVisible();
	});

	test('home page keeps the requested page size across searches', async ({ page }) => {
		await page.goto('/?pageSize=50');
		// the choice rides along as a hidden input so a fresh search keeps it
		await expect(page.locator('input[name="pageSize"]')).toHaveValue('50');
		await expect(page.getByText(/Showing 1 to \d+ of \d+ results/)).toBeVisible();
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

	// only the journey uses the added consultees, and Playwright runs beforeAll/afterAll once per
	// worker - so they're set up by the journey itself and removed after it alone, never while
	// another worker's journey (a retry included) is using them
	// eslint-disable-next-line no-empty-pattern -- Playwright requires its fixtures argument destructured
	test.afterEach(async ({}, testInfo) => {
		if (testInfo.title !== JOURNEY_TITLE) {
			return;
		}
		const db = newDatabaseClient(connectionString);
		try {
			await deleteE2eAddedConsultees(db);
		} finally {
			await db.$disconnect();
		}
	});

	test(JOURNEY_TITLE, async ({ page }) => {
		// a dozen pages, a ruleset run and the download's maps come close to 30s on a full reference
		// data load
		test.slow();
		const db = newDatabaseClient(connectionString);
		try {
			await deleteE2eAddedConsultees(db);
			await loadConsulteeAreas(db, { type: 'FeatureCollection', features: E2E_ADDED_CONSULTEES });
		} finally {
			await db.$disconnect();
		}
		await page.goto(`/?q=${SAMPLE_CASE_REFERENCE}`);
		// a caseReference isn't guaranteed unique (a project can have several boundary submissions),
		// so follow the link by its href (a specific case id) rather than by its visible text
		await page.locator(`a[href="/consultees/${SAMPLE_CASE_ID}"]`).click();

		// the boundary page maps the case's shapefiles; the radios below confirm the single file
		// carried forward
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Project boundary');
		await expect(page.getByText(SAMPLE_CASE_NAME).first()).toBeVisible();
		const shapefileRadios = page.getByRole('radio');
		expect(await shapefileRadios.count()).toBeGreaterThanOrEqual(1);
		// no radio is pre-selected - pick the page's own file to stay on the same case id
		await page.locator(`input[name="shapefile"][value="${SAMPLE_CASE_ID}"]`).check();
		await page.getByRole('button', { name: 'Continue' }).click();

		// the ruleset page picks the ruleset the report is generated with
		await expect(page).toHaveURL(new RegExp(`/consultees/${SAMPLE_CASE_ID}/ruleset`));
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Ruleset');
		await expect(page.getByText(SAMPLE_CASE_NAME).first()).toBeVisible();
		await page.getByRole('radio', { name: SAMPLE_RULESET_NAME }).check();
		await page.getByRole('button', { name: 'Identify consultees' }).click();

		// the check page lists each category's consultee names (the first five, the rest behind a
		// closed "Show more" - still in the DOM) - its Change page lists them all
		await expect(page).toHaveURL(new RegExp(`/consultees/${SAMPLE_CASE_ID}/report\\?ruleset=${SAMPLE_RULESET_ID}`));
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Check consultees before creating the report');
		// the other cases near the site are listed like any category, under their own heading
		await expect(page.getByRole('heading', { level: 3, name: 'Nearby NSIPs' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Change Nearby NSIPs' })).toBeVisible();

		const parishChange = page.getByRole('link', { name: 'Change Parish Council' });
		const parishValue = page
			.locator('.govuk-summary-list__row', { has: parishChange })
			.locator('.govuk-summary-list__value');
		const parishListed = await parishValue.locator('li').count();
		// one name renders as text, not a list; "No consultees" as neither
		const parishCount =
			parishListed > 0 ? parishListed : (await parishValue.innerText()).trim() === 'No consultees' ? 0 : 1;
		await parishChange.click();

		await expect(page).toHaveURL(/\/report\/consultees\?.*category=Parish/);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Parish Council');
		await expect(page.getByRole('heading', { level: 2, name: 'Consultees' })).toBeVisible();
		const removeLinks = page.getByRole('link', { name: /Remove/ });
		await expect(removeLinks).toHaveCount(parishCount);

		// removing a consultee opens a reason page first - a blank reason fails
		// validation; submitting one returns to the category page with the row
		// excluded and the removal listed in the open Removed consultees section
		let removed = 0;
		if (parishCount > 0) {
			await removeLinks.first().click();
			await expect(page).toHaveURL(/\/report\/consultees\/remove\?.*match=/);
			await expect(page.getByRole('heading', { level: 1 })).toContainText('Remove consultee');
			await page.getByRole('button', { name: 'Remove consultee' }).click();
			await expect(page.getByText('There is a problem')).toBeVisible();
			await expect(page.getByRole('link', { name: 'Enter a reason for removing this consultee.' })).toBeVisible();
			await page.getByLabel('Reason for removing').fill('Duplicate of another consultee');
			await page.getByRole('button', { name: 'Remove consultee' }).click();
			await expect(page).toHaveURL(/\/report\/consultees\?.*exclude=/);
			await expect(page.getByRole('link', { name: /Remove/ })).toHaveCount(parishCount - 1);
			await expect(page.getByText('Duplicate of another consultee')).toBeVisible();
			removed = 1;
		}

		// "Add a consultee" opens its own page: a name - matched to the category's consultees only the
		// nearby search found (the faint ones on its map) as it's typed - and a reason, both required.
		// A blank submit fails on both and stays on the page; a blank name then fails with the reason kept
		await page.getByRole('button', { name: 'Add a consultee' }).click();
		await expect(page).toHaveURL(/\/report\/consultees\/add\?.*category=Parish/);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Add a consultee');
		const nameInput = page.getByLabel('Name of consultee');
		// the add page's own submit button - "Add consultee" - not the category page's "Add a consultee" link
		const addButton = page.getByRole('button', { name: 'Add consultee' });
		await addButton.click();
		await expect(page.getByText('There is a problem')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Enter the consultee name' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Enter a reason for adding this consultee.' })).toBeVisible();
		await page.getByLabel('Reason for adding').fill('Entered first');
		await addButton.click();
		await expect(page.getByRole('link', { name: 'Enter the consultee name' })).toBeVisible();
		await expect(page.getByText('Error: Enter the consultee name')).toBeVisible();
		await expect(page.getByLabel('Reason for adding')).toHaveValue('Entered first');

		// a name that isn't a consultee in the reference data is refused, saying so above the form
		await nameInput.fill('Banana');
		await addButton.click();
		await expect(page.getByText('There is a problem')).toBeVisible();
		await expect(
			page.getByRole('link', { name: 'Banana does not exist as a Parish Council consultee. Enter a valid consultee.' })
		).toBeVisible();

		// adding a consultee returns to the category page with it listed below the map - and any
		// number can be added one at a time
		await nameInput.fill('First Test Consultee');
		await addButton.click();
		await expect(page).toHaveURL(/\/report\/consultees\?.*category=Parish.*add=/);
		await expect(page.getByRole('rowheader', { name: 'First Test Consultee' })).toBeVisible();
		await expect(page.getByText('Entered first')).toBeVisible();

		// back on the add page, with nearby consultees to suggest, the GOV.UK accessible autocomplete
		// offers them as a name is typed - picking one adds it by name, and the map draws it as
		// identified. The seeded data decides whether there are any
		let picked = 0;
		await page.getByRole('button', { name: 'Add a consultee' }).click();
		await expect(page).toHaveURL(/\/report\/consultees\/add\?.*category=Parish.*add=/);
		if ((await page.locator('.autocomplete__wrapper').count()) > 0) {
			const suggestions = page.locator('.autocomplete__option');
			for (const letter of 'aeiourn') {
				await nameInput.fill(letter);
				if (
					await suggestions
						.first()
						.isVisible({ timeout: 1_000 })
						.catch(() => false)
				) {
					break;
				}
			}
			await suggestions.first().click();
			const pickedName = await nameInput.inputValue();
			await page.getByLabel('Reason for adding').fill('Picked from nearby');
			await addButton.click();
			await expect(page.getByRole('rowheader', { name: pickedName, exact: true })).toBeVisible();
			await expect(page.getByText('Picked from nearby')).toBeVisible();
			// added by its id - the selection travels base64url-encoded, so read the last add back
			const lastAdd = new URL(page.url()).searchParams.getAll('add').at(-1) ?? '';
			expect(JSON.parse(Buffer.from(lastAdd, 'base64url').toString('utf8'))).toHaveProperty('i');
			picked = 1;
		}

		// a successful add landed back on the category page - open the add page again for the next one
		if (picked === 1) {
			await page.getByRole('button', { name: 'Add a consultee' }).click();
		}
		await nameInput.fill('Second Test Consultee');
		await page.getByLabel('Reason for adding').fill('Borders the site');
		await addButton.click();
		await expect(page.getByRole('rowheader', { name: 'Second Test Consultee' })).toBeVisible();
		await expect(page.getByText('Borders the site')).toBeVisible();
		await expect(page.getByRole('link', { name: /Remove/ })).toHaveCount(parishCount - removed + picked + 2);

		// a hand-added consultee's Remove link goes through the same reason page -
		// its row leaves the Consultees table and joins Removed consultees instead
		await page.getByRole('link', { name: 'Remove Second Test Consultee' }).click();
		await expect(page).toHaveURL(/\/report\/consultees\/remove\?.*added=/);
		await expect(page.getByRole('rowheader', { name: 'Second Test Consultee' })).toBeVisible();
		await page.getByLabel('Reason for removing').fill('Added in error');
		await page.getByRole('button', { name: 'Remove consultee' }).click();
		const consulteesTable = page.getByRole('table', { name: 'Consultees', exact: true });
		await expect(consulteesTable.getByRole('rowheader', { name: 'Second Test Consultee' })).toHaveCount(0);
		await expect(consulteesTable.getByRole('rowheader', { name: 'First Test Consultee' })).toBeVisible();
		const removedTable = page.getByRole('table', { name: 'Removed consultees' });
		await expect(removedTable.getByRole('rowheader', { name: 'Second Test Consultee' })).toBeVisible();
		await expect(removedTable.getByRole('row', { name: /Added in error/ })).toBeVisible();
		await expect(page.getByRole('link', { name: /Remove/ })).toHaveCount(parishCount - removed + picked + 1);

		// "Save and return" lands back on the check page - the row's names matching the rows just
		// listed (past the fifth the names sit behind a closed "Show more" - still in the DOM)
		await page.getByRole('button', { name: 'Save and return' }).click();
		await expect(page).toHaveURL(new RegExp(`/consultees/${SAMPLE_CASE_ID}/report\\?ruleset=${SAMPLE_RULESET_ID}`));
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Check consultees before creating the report');
		const returnedValue = page
			.locator('.govuk-summary-list__row', { hasText: 'Parish Council' })
			.locator('.govuk-summary-list__value')
			.first();
		const expectedTotal = parishCount - removed + picked + 1;
		// one name renders as text, not a list item; "No consultees" as neither
		const listedNames = await returnedValue.locator('li').allInnerTexts();
		const count = listedNames.length || ((await returnedValue.innerText()).trim() === 'No consultees' ? 0 : 1);
		expect(count).toBe(expectedTotal);
		expect((await returnedValue.innerHTML()).includes('First Test Consultee')).toBe(true);
		// past the fifth name the rest sit behind a closed "Show more" (still in the DOM)
		if (expectedTotal > 5) {
			await expect(returnedValue.getByText('Show more')).toBeVisible();
		}

		// "Create report" leads to the confirmation page with the download link, naming the built ZIP's size
		await page.getByRole('button', { name: 'Create report' }).click();
		await expect(page).toHaveURL(
			new RegExp(`/consultees/${SAMPLE_CASE_ID}/report/created\\?ruleset=${SAMPLE_RULESET_ID}`)
		);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Report created');
		// the download is the ZIP the page built - an Excel workbook and a PDF of each category's map,
		// with the selection carried into it - kept for the link to serve
		const downloadLink = page.getByRole('link', {
			name: new RegExp(`Download ${SAMPLE_CASE_NAME} Consultee List report \\(ZIP, `)
		});
		await expect(downloadLink).toBeVisible();
		const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
		expect(download.suggestedFilename()).toMatch(/consultee report \d{4}-\d{2}-\d{2}\.zip$/);
		const files = Object.keys(unzipSync(new Uint8Array(await readFile(await download.path()))));
		expect(files.filter((file) => file.endsWith('.xlsx'))).toHaveLength(1);
		expect(files.filter((file) => /^maps\/\d{2} Parish Council\.pdf$/.test(file))).toHaveLength(1);

		// the same selection's report page still lists the matched consultees
		await page.goto(`/consultees/${SAMPLE_CASE_ID}/results?ruleset=${SAMPLE_RULESET_ID}`);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Consultees identified for');
		await expect(page.getByText(`Ruleset used: ${SAMPLE_RULESET_NAME}`)).toBeVisible();
		await expect(page.getByRole('heading', { level: 2, name: 'Consultees identified' })).toBeVisible();
	});

	test('the boundary page offers the project’s shapefiles and continues with one', async ({ page }) => {
		await page.goto(`/consultees/${SAMPLE_CASE_ID}`);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Project boundary');
		await expect(page.getByText('Confirm shapefile for report')).toBeVisible();

		const radios = page.getByRole('radio');
		// one radio per stored boundary file
		expect(await radios.count()).toBeGreaterThanOrEqual(1);
		await radios.first().check();
		await page.getByRole('button', { name: 'Continue' }).click();
		await expect(page).toHaveURL(/\/consultees\/[0-9a-f-]{36}\/ruleset/);
	});

	test('a direct link to the project boundary page works', async ({ page }) => {
		await page.goto(`/consultees/${SAMPLE_CASE_ID}`);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Project boundary');
		await expect(page.getByText(SAMPLE_CASE_NAME).first()).toBeVisible();
		await expect(page.getByRole('link', { name: 'Back to projects' })).toBeVisible();
	});

	test('map layers demo page renders layer summaries', async ({ page }) => {
		await page.goto('/map-layers-demo');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Map layers demo');
		await expect(page.getByRole('rowheader', { name: 'Railway lines' })).toBeVisible();
		await expect(page.getByRole('rowheader', { name: 'Road network' })).toBeVisible();
		await expect(page.locator('.app-map-layers-demo')).toBeVisible();
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
