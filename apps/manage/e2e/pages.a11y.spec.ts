import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Result } from 'axe-core';

const pages = [
	{ path: '/', name: 'home' },
	{ path: '/consultees/geo-1', name: 'consultees results' },
	{ path: '/map-layers-demo', name: 'map layers demo' },
	{ path: '/signed-out', name: 'signed out' },
	{ path: '/items', name: 'items list' },
	{ path: '/error/firewall-error', name: 'firewall error' },
	{ path: '/this-page-does-not-exist', name: '404' }
] as const;

test.describe('browser accessibility', () => {
	for (const pageCase of pages) {
		test(`${pageCase.name} has no critical or serious axe violations`, async ({ page }) => {
			await page.goto(pageCase.path);
			const results = await new AxeBuilder({ page })
				.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
				.analyze();

			const serious = results.violations.filter(
				(violation: Result) => violation.impact === 'critical' || violation.impact === 'serious'
			);

			expect(serious, serious.map((v: Result) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
		});
	}
});
