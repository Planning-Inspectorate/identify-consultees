import { expect, test } from '@playwright/test';

test.describe('measure plugin smoke', () => {
	test('measure menu starts a session and a two-point distance lands in the panel', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (err) => errors.push(String(err)));

		// the basemap isn't under test - serve a minimal MapLibre style so the map
		// initialises without depending on live OpenFreeMap tiles
		await page.route('https://tiles.openfreemap.org/**', async (route) => {
			if (route.request().url().includes('/styles/')) {
				await route.fulfill({
					contentType: 'application/json',
					body: JSON.stringify({
						version: 8,
						sources: {},
						layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f4f4f0' } }]
					})
				});
			} else {
				await route.abort();
			}
		});

		await page.goto('/components/interactive-map/measure?components=true', { waitUntil: 'domcontentloaded' });

		// the interactive shell mounts (canvas proves maplibre loaded, not the static fallback)
		await expect(page.locator('#interactive-map-example-measure canvas')).toBeVisible({ timeout: 30000 });

		const measureButton = page.getByRole('button', { name: /^measure$/i });
		await expect(measureButton).toBeVisible();
		await measureButton.click();

		// the menu offers the three configured tools
		const distance = page.getByRole('menuitem', { name: /between two points/i });
		await expect(distance).toBeVisible();
		await expect(page.getByRole('menuitem', { name: /along a path/i })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: /of a bounded box/i })).toBeVisible();
		await distance.click();

		// the draw plugin's own session chrome appears while drawing
		const panel = page.locator('.app-measure-panel');
		await expect(panel).toContainText(/click two points/i);
		await expect(page.getByRole('button', { name: /done/i })).toBeVisible();

		// click two points near the map centre — the session auto-finishes. The live
		// readout only appears once the first vertex is committed, so hovering the
		// second point and waiting for it proves the first click landed (synthetic
		// clicks can be dropped while the map settles under parallel load)
		const box = await page.locator('#interactive-map-example-measure').boundingBox();
		const result = panel.locator('.app-measure-result');
		const first = { x: box.x + box.width / 2 - 80, y: box.y + box.height / 2 };
		const second = { x: box.x + box.width / 2 + 80, y: box.y + box.height / 2 };
		for (let attempt = 0; attempt < 3; attempt++) {
			await page.mouse.click(first.x, first.y - attempt * 20);
			await page.mouse.move(second.x, second.y);
			try {
				await result.waitFor({ state: 'attached', timeout: 2000 });
				break;
			} catch {
				// first click was dropped - try again
			}
		}
		await page.mouse.click(second.x, second.y);

		// the finished measurement lands in the panel with the units switcher
		// (the Clear button only renders once the session is done)
		await expect(panel.getByRole('button', { name: /clear measurement/i })).toBeVisible({ timeout: 10000 });
		await expect(result).toContainText(/\d+(\.\d+)?\s?m\b/);
		await expect(panel.getByLabel(/units/i)).toBeVisible();

		// switching units re-renders the value
		await panel.getByLabel(/units/i).selectOption('km');
		await expect(result).toContainText(/\d+(\.\d+)?\s?km\b/);

		expect(errors).toEqual([]);
	});
});
