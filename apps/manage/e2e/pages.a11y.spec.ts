import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Result } from 'axe-core';
import { SAMPLE_CASE_ID, SAMPLE_RULESET_ID } from './fixtures.ts';

/**
 * Browser accessibility checks (Chromium).
 *
 * Covers every HTML route users can reach with auth disabled, plus a few
 * meaningful UI states (empty search, pagination, ruleset query, Python
 * function page). Critical/serious axe impacts fail the build.
 */
const pages = [
	{ path: '/', name: 'home' },
	{ path: '/?q=ZZZ-NOMATCH-XXX', name: 'home with no search results' },
	{ path: '/?pageSize=50', name: 'home with 50 results per page' },
	{ path: `/consultees/${SAMPLE_CASE_ID}`, name: 'project map' },
	{ path: `/consultees/${SAMPLE_CASE_ID}/ruleset`, name: 'ruleset picker' },
	{ path: `/consultees/${SAMPLE_CASE_ID}/shapefile`, name: 'shapefile picker' },
	{ path: `/consultees/${SAMPLE_CASE_ID}/report?ruleset=${SAMPLE_RULESET_ID}`, name: 'report check' },
	{
		path: `/consultees/${SAMPLE_CASE_ID}/report/consultees?ruleset=${SAMPLE_RULESET_ID}&category=Parish%20Council`,
		name: 'report consultees'
	},
	{
		path: `/consultees/${SAMPLE_CASE_ID}/report/consultees/add?ruleset=${SAMPLE_RULESET_ID}&category=Parish%20Council`,
		name: 'report consultee add'
	},
	{ path: `/consultees/${SAMPLE_CASE_ID}/report/created?ruleset=${SAMPLE_RULESET_ID}`, name: 'report created' },
	{
		path: `/consultees/${SAMPLE_CASE_ID}/results?ruleset=${SAMPLE_RULESET_ID}`,
		name: 'consultees results'
	},
	{ path: '/map-layers-demo', name: 'map layers demo' },
	{ path: '/components?components=true', name: 'components index' },
	{ path: '/components/checkboxes?components=true', name: 'component detail' },
	{
		path: '/components/interactive-map?components=true',
		name: 'interactive map examples index'
	},
	{
		path: '/components/interactive-map/polygons?components=true',
		name: 'interactive map example'
	},
	{ path: '/signed-out', name: 'signed out' },
	{ path: '/terms-and-conditions', name: 'terms and conditions' },
	{ path: '/accessibility-statement', name: 'accessibility statement' },
	{ path: '/cookies', name: 'cookies' },
	{ path: '/contact', name: 'contact' },
	{ path: '/items', name: 'items list' },
	{ path: '/consultee-areas-python', name: 'consultee areas python' },
	{ path: '/unauthenticated', name: '401 unauthenticated' },
	{ path: '/error/firewall-error', name: 'firewall error' },
	{ path: '/this-page-does-not-exist', name: '404' }
] as const;

async function expectNoSeriousAxeViolations(page: Parameters<typeof AxeBuilder>[0]['page']) {
	const results = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
		// GOV.UK Frontend's own header/service navigation markup doesn't yet meet WCAG 2.2's
		// target-size criterion (a known upstream gap, not something to patch here) - exact
		// pixel sizing is also font-rendering-dependent across platforms, so this can pass
		// locally and fail in CI (or vice versa) even with identical markup
		.disableRules(['target-size'])
		.analyze();

	const serious = results.violations.filter(
		(violation: Result) => violation.impact === 'critical' || violation.impact === 'serious'
	);

	expect(serious, serious.map((v: Result) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
}

test.describe('browser accessibility', () => {
	for (const pageCase of pages) {
		test(`${pageCase.name} has no critical or serious axe violations`, async ({ page }) => {
			await page.goto(pageCase.path);
			await expect(page.locator('#main-content, main').first()).toBeVisible();
			await expectNoSeriousAxeViolations(page);
		});
	}
});

test.describe('browser accessibility landmarks and skip link', () => {
	test('home page exposes skip link, banner, navigation, main, and contentinfo', async ({ page }) => {
		await page.goto('/');

		const skipLink = page.locator('.govuk-skip-link').first();
		await expect(skipLink).toBeAttached();
		await expect(skipLink).toHaveAttribute('href', /#main-content|#content/);

		await expect(page.getByRole('banner').first()).toBeVisible();
		await expect(page.getByRole('navigation').first()).toBeVisible();
		await expect(page.getByRole('main')).toBeVisible();
		await expect(page.getByRole('contentinfo').first()).toBeVisible();
	});

	test('consultees results page keeps its map region labelled', async ({ page }) => {
		await page.goto(`/consultees/${SAMPLE_CASE_ID}/results?ruleset=${SAMPLE_RULESET_ID}`);

		await expect(page.locator('.app-consultee-map[role="region"]').first()).toBeAttached();
		await expect(page.locator('.app-consultee-map').first()).toHaveAttribute('aria-label', /.+/);

		await expectNoSeriousAxeViolations(page);
	});

	test('interactive map example host remains an accessible region', async ({ page }) => {
		await page.goto('/components/interactive-map/basic?components=true');

		const host = page.locator('.app-interactive-map-example[role="region"]');
		await expect(host).toBeAttached();
		await expect(host).toHaveAttribute('aria-label', /.+/);

		await expectNoSeriousAxeViolations(page);
	});

	test('map layers demo map host remains an accessible region', async ({ page }) => {
		await page.goto('/map-layers-demo');

		const host = page.locator('.app-map-layers-demo[role="region"]');
		await expect(host).toBeAttached();
		await expect(host).toHaveAttribute('aria-label', /.+/);

		await expectNoSeriousAxeViolations(page);
	});
});

test.describe('browser accessibility keyboard focus', () => {
	async function tabUntil(page: Parameters<typeof AxeBuilder>[0]['page'], targetId: string, maxPresses = 20) {
		for (let i = 0; i < maxPresses; i += 1) {
			await page.keyboard.press('Tab');
			const id = await page.locator(':focus').getAttribute('id');
			if (id === targetId) {
				return true;
			}
		}
		return false;
	}

	test('home search control is reachable in tab order', async ({ page }) => {
		await page.goto('/');

		// First Tab often focuses the skip link; continue until the search input
		expect(await tabUntil(page, 'q')).toBe(true);

		await expectNoSeriousAxeViolations(page);
	});

	test('ruleset picker radio is reachable in tab order', async ({ page }) => {
		await page.goto(`/consultees/${SAMPLE_CASE_ID}/ruleset`);

		expect(await tabUntil(page, 'ruleset')).toBe(true);

		await expectNoSeriousAxeViolations(page);
	});
});
