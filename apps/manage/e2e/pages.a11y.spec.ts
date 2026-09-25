import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Result } from 'axe-core';

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
	{ path: '/?ruleset=scotland', name: 'home with Scotland ruleset' },
	{ path: '/consultees/geo-1', name: 'consultees results' },
	{
		path: '/consultees/geo-1?ruleset=post-30-apr-2024-england-wales',
		name: 'consultees results with ruleset'
	},
	{ path: '/map-layers-demo', name: 'map layers demo' },
	{ path: '/signed-out', name: 'signed out' },
	{ path: '/items', name: 'items list' },
	{ path: '/consultee-areas-python', name: 'consultee areas python' },
	{ path: '/unauthenticated', name: '401 unauthenticated' },
	{ path: '/error/firewall-error', name: 'firewall error' },
	{ path: '/this-page-does-not-exist', name: '404' }
] as const;

async function expectNoSeriousAxeViolations(page: Parameters<typeof AxeBuilder>[0]['page']) {
	const results = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
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

	test('consultees results page keeps section nav and map regions labelled', async ({ page }) => {
		await page.goto('/consultees/geo-1');

		await expect(page.getByRole('navigation', { name: 'Consultee map sections' })).toBeVisible();
		await expect(page.locator('[data-consultee-map][role="region"]').first()).toBeAttached();
		await expect(page.locator('[data-consultee-map]').first()).toHaveAttribute('aria-label', /.+/);

		await expectNoSeriousAxeViolations(page);
	});

	test('map layers demo map host remains an accessible region', async ({ page }) => {
		await page.goto('/map-layers-demo');

		const host = page.locator('[data-map-layers-demo][role="region"]');
		await expect(host).toBeAttached();
		await expect(host).toHaveAttribute('aria-label', /.+/);

		await expectNoSeriousAxeViolations(page);
	});
});

test.describe('browser accessibility keyboard focus', () => {
	test('home search controls are reachable in tab order', async ({ page }) => {
		await page.goto('/');

		await page.keyboard.press('Tab');
		// First Tab often focuses the skip link; continue until the ruleset select
		let focusedRuleset = false;
		for (let i = 0; i < 20; i += 1) {
			const focused = page.locator(':focus');
			const id = await focused.getAttribute('id');
			if (id === 'ruleset') {
				focusedRuleset = true;
				break;
			}
			await page.keyboard.press('Tab');
		}
		expect(focusedRuleset).toBe(true);

		await page.keyboard.press('Tab');
		await expect(page.locator(':focus')).toHaveAttribute('id', 'q');

		await expectNoSeriousAxeViolations(page);
	});
});
