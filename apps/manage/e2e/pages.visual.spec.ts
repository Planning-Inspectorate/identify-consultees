import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { SAMPLE_CASE_ID, SAMPLE_CASE_REFERENCE, SAMPLE_RULESET_ID } from './fixtures.ts';

/**
 * Visual regression baselines for every page the manage app currently serves.
 *
 * Opt-in only — not run by `npm test`, `npm run test:e2e`, or the Azure pipeline
 * while the UI is still changing. Run intentionally with:
 *
 *   npm run test:visual          # compare against committed baselines
 *   npm run test:visual:update   # refresh baselines after a deliberate UI change
 *
 * Determinism notes:
 * - Interactive (maplibre) map regions are masked — canvas/tile rendering is
 *   timing-dependent and never pixel-stable. The map containers are fixed-size,
 *   so the surrounding layout is still compared pixel-for-pixel.
 * - Screenshots are full-page and taken only after webfonts finish loading.
 * - Baselines are platform-specific (Playwright appends `-darwin`, `-linux`
 *   etc.) — macOS and Linux do not render identical pixels, so enabling this in
 *   the pipeline means generating Linux baselines on the CI OS.
 */

// every interactive map host class/attribute in the app: the map canvas itself is
// masked, everything around it (chrome, tables, keys/legends) is still compared
const MAP_MASK = '.app-case-map, .app-consultee-map, .app-map-layers-demo, .app-interactive-map-example';

const pages = [
	{ path: '/', name: 'home' },
	{ path: `/?q=${SAMPLE_CASE_REFERENCE}`, name: 'home-search-results' },
	{ path: '/?q=ZZZ-NOMATCH-XXX', name: 'home-no-results' },
	{ path: '/?pageSize=50', name: 'home-page-size-50' },
	{ path: `/consultees/${SAMPLE_CASE_ID}`, name: 'project-map', mask: MAP_MASK },
	{ path: `/consultees/${SAMPLE_CASE_ID}/ruleset`, name: 'ruleset-picker' },
	{ path: `/consultees/${SAMPLE_CASE_ID}/shapefile`, name: 'shapefile-picker' },
	{ path: `/consultees/${SAMPLE_CASE_ID}/report?ruleset=${SAMPLE_RULESET_ID}`, name: 'report-check' },
	{
		path: `/consultees/${SAMPLE_CASE_ID}/report/consultees?ruleset=${SAMPLE_RULESET_ID}&category=Parish%20Council`,
		name: 'report-consultees',
		mask: MAP_MASK
	},
	{
		path: `/consultees/${SAMPLE_CASE_ID}/report/consultees/add?ruleset=${SAMPLE_RULESET_ID}&category=Parish%20Council`,
		name: 'report-consultee-add'
	},
	{
		path: `/consultees/${SAMPLE_CASE_ID}/report/created?ruleset=${SAMPLE_RULESET_ID}`,
		name: 'report-created'
	},
	{
		path: `/consultees/${SAMPLE_CASE_ID}/results?ruleset=${SAMPLE_RULESET_ID}`,
		name: 'consultees-results',
		mask: MAP_MASK
	},
	{ path: '/map-layers-demo', name: 'map-layers-demo', mask: MAP_MASK },
	{ path: '/components?components=true', name: 'components-index' },
	{ path: '/components/checkboxes?components=true', name: 'component-detail' },
	{ path: '/components/interactive-map?components=true', name: 'interactive-map-examples-index' },
	{
		path: '/components/interactive-map/polygons?components=true',
		name: 'interactive-map-example',
		mask: MAP_MASK
	},
	{ path: '/signed-out', name: 'signed-out' },
	{ path: '/terms-and-conditions', name: 'terms-and-conditions' },
	{ path: '/accessibility-statement', name: 'accessibility-statement' },
	{ path: '/privacy', name: 'privacy' },
	{ path: '/cookies', name: 'cookies' },
	{ path: '/contact', name: 'contact' },
	{ path: '/items', name: 'items-list' },
	{ path: '/consultee-areas-python', name: 'consultee-areas-python' },
	{ path: '/consultee-areas-direct', name: 'consultee-areas-direct' },
	{ path: '/admin/upload-to-blob', name: 'admin-upload-to-blob' },
	{ path: '/admin/import-reference-data', name: 'admin-import-reference-data' },
	{ path: '/unauthenticated', name: 'unauthenticated-401' },
	{ path: '/error/firewall-error', name: 'firewall-error' },
	{ path: '/this-page-does-not-exist', name: 'page-not-found-404' }
] as const;

/** GOV.UK webfonts swap in after first paint — wait for them so glyph pixels are stable. */
async function waitForFonts(page: Page) {
	await page.waitForFunction(() => document.fonts.status === 'loaded');
}

test.describe('visual regression @visual', () => {
	for (const pageCase of pages) {
		test(pageCase.name, async ({ page }) => {
			await page.goto(pageCase.path);
			await expect(page.locator('#main-content, main').first()).toBeVisible();
			await waitForFonts(page);

			await expect(page).toHaveScreenshot(`${pageCase.name}.png`, {
				fullPage: true,
				mask: pageCase.mask ? [page.locator(pageCase.mask)] : []
			});
		});
	}
});
