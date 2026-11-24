import { expect, test, type Page } from '@playwright/test';
import { SAMPLE_CASE_ID, SAMPLE_RULESET_ID } from './fixtures.ts';

/**
 * Map boot-state checks: every map page must end in a usable map - the interactive
 * map mounted, or the static fallback swapped in when it can't be. DOM presence is
 * not proof: the container renders either way, and a plugin mount crash (see
 * docs/maps.md's draw-adapter note) leaves a dead map under passing assertions.
 * The measure click-through then exercises a plugin interaction the way
 * docs/maps.md requires - a real menu open and canvas clicks, not markup checks.
 *
 * Which end state a run reaches depends on tile hosts being reachable - OpenFreeMap
 * when no OS key is set - so both are accepted; pageerror is not.
 */

const MAP_PAGES = [
	{ path: `/consultees/${SAMPLE_CASE_ID}`, name: 'project boundary' },
	{
		path: `/consultees/${SAMPLE_CASE_ID}/report/consultees?ruleset=${SAMPLE_RULESET_ID}&category=Parish%2C%20town%20and%20community%20councils`,
		name: 'report consultees'
	}
] as const;

const CANVAS = 'canvas.maplibregl-canvas';
const FALLBACK_IMG = 'img.app-case-map-static';
const LOADING = '.app-map-loading';

function collectPageErrors(page: Page) {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(String(error)));
	return errors;
}

test.describe('interactive map boot', () => {
	for (const mapPage of MAP_PAGES) {
		test(`${mapPage.name} ends in a usable map state`, async ({ page }) => {
			const pageErrors = collectPageErrors(page);
			await page.goto(mapPage.path);

			const mapRegion = page.locator('.app-consultee-map').first();
			// the loading overlay leaves the DOM when the map first idles, and the fallback
			// swap removes it too - either a mounted canvas or the static image must appear
			await expect(mapRegion.locator(CANVAS).or(mapRegion.locator(FALLBACK_IMG)).first()).toBeAttached({
				timeout: 45_000
			});
			await expect(mapRegion.locator(LOADING)).toHaveCount(0, { timeout: 45_000 });

			expect(pageErrors, 'page errors while the map settled').toEqual([]);
		});
	}

	test('the Measure tool draws a measurement on the category map', async ({ page }) => {
		const pageErrors = collectPageErrors(page);
		await page.goto(MAP_PAGES[1].path);

		const mapRegion = page.locator('.app-consultee-map').first();
		await expect(mapRegion.locator(CANVAS).or(mapRegion.locator(FALLBACK_IMG)).first()).toBeAttached({
			timeout: 45_000
		});
		// no Measure button exists on the fallback - the tool needs the booted map. Skipping
		// here records that the environment fell back, rather than pretending it was tested
		test.skip(
			(await mapRegion.locator(CANVAS).count()) === 0,
			'interactive map did not boot in this environment - the static fallback covered the page'
		);
		await expect(mapRegion.locator(LOADING)).toHaveCount(0, { timeout: 45_000 });

		await page.getByRole('button', { name: 'Measure', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Between two points' }).click();

		const box = await mapRegion.locator(CANVAS).boundingBox();
		if (!box) {
			throw new Error('map canvas has no bounding box');
		}
		await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
		await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);

		// the panel shows the measured distance in the default metric unit
		await expect(mapRegion.getByText(/\d[\d,]*\s*m\b/)).toBeVisible({ timeout: 15_000 });

		expect(pageErrors, 'page errors during the measure click-through').toEqual([]);
	});
});

test.describe('static map endpoints', () => {
	// the static maps are what no-JS users and interactive-map failures actually get - the
	// render spec only checks the page config names one. Asserting the served image also
	// proves the ETag revalidation docs/maps.md requires: a 304 answers without upstream
	// tile fetches, so If-None-Match is the cheapest request there is
	const STATIC_MAP_ROUTES = [
		{ path: `/consultees/${SAMPLE_CASE_ID}/boundary-map.svg`, name: 'boundary map SVG' },
		{
			path: `/consultees/${SAMPLE_CASE_ID}/results/static-map.svg?ruleset=${SAMPLE_RULESET_ID}`,
			name: 'results static map SVG'
		},
		{
			path: `/consultees/${SAMPLE_CASE_ID}/results/static-map?ruleset=${SAMPLE_RULESET_ID}`,
			name: 'results static map'
		}
	] as const;

	for (const route of STATIC_MAP_ROUTES) {
		test(`${route.name} serves an image and revalidates by ETag`, async ({ request }) => {
			const response = await request.get(route.path);
			expect(response.ok(), `${route.name} did not serve`).toBeTruthy();
			expect(response.headers()['content-type'], `${route.name} content type`).toMatch(/^image\//);

			const etag = response.headers()['etag'];
			expect(etag, `${route.name} sent no ETag`).toBeTruthy();
			const revalidated = await request.get(route.path, { headers: { 'if-none-match': etag } });
			expect(revalidated.status(), `${route.name} did not honour If-None-Match`).toBe(304);
		});
	}
});
