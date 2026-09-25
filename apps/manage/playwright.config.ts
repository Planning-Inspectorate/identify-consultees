import { defineConfig, devices } from '@playwright/test';

const e2ePort = process.env.E2E_PORT || '8091';
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${e2ePort}`;

/**
 * Frontend browser tests for the manage app.
 *
 * Default projects run under `npm test` / `npm run test:e2e`:
 * - Chromium: e2e journeys + browser a11y
 * - Firefox + WebKit (Safari engine): render-completeness checks
 *
 * Visual regression (`chromium-visual`) is configured but excluded from the
 * default run until the UI is closer to finished — use `npm run test:visual`.
 */
export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	workers: process.env.CI ? 2 : undefined,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure'
	},
	webServer: {
		command: 'node --experimental-strip-types scripts/e2e-server.mjs',
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		env: {
			...process.env,
			E2E_PORT: e2ePort
		}
	},
	projects: [
		{
			name: 'chromium-e2e',
			testMatch: /.*\.e2e\.spec\.ts/,
			use: { ...devices['Desktop Chrome'] }
		},
		{
			name: 'chromium-a11y',
			testMatch: /.*\.a11y\.spec\.ts/,
			use: { ...devices['Desktop Chrome'] }
		},
		{
			name: 'firefox-render',
			testMatch: /.*\.render\.spec\.ts/,
			use: { ...devices['Desktop Firefox'] }
		},
		{
			// Playwright WebKit covers Safari rendering (Safari itself is macOS-only)
			name: 'webkit-render',
			testMatch: /.*\.render\.spec\.ts/,
			use: { ...devices['Desktop Safari'] }
		},
		{
			name: 'chromium-visual',
			testMatch: /.*\.visual\.spec\.ts/,
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1280, height: 720 }
			},
			expect: {
				toHaveScreenshot: {
					maxDiffPixelRatio: 0.02
				}
			}
		}
	]
});
