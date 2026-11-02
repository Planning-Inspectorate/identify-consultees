import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';

const e2ePort = process.env.E2E_PORT || '8091';
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${e2ePort}`;
// Azure Pipelines sets TF_BUILD, not CI
const isCi = Boolean(process.env.CI || process.env.TF_BUILD);

// macOS 27 TCC-protects ~/Library/Application Support/Firefox, and the bundled
// juggler Firefox still resolves its shared app-data dir there even with
// -profile set - launched from a terminal rather than Finder it is denied and
// exits with "Could not find profile folder" (microsoft/playwright#42768, fixed
// upstream in 1.65 - drop this once @playwright/test reaches it).
// CFFIXED_USER_HOME redirects Gecko's home-dir lookup to a scratch dir it can
// write. env replaces the browser's environment wholesale, so process.env has
// to be spread back in.
const firefoxLaunchEnv =
	process.platform === 'darwin'
		? { ...process.env, CFFIXED_USER_HOME: mkdtempSync(join(tmpdir(), 'playwright-firefox-home-')) }
		: undefined;

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
	forbidOnly: isCi,
	retries: isCi ? 1 : 0,
	// all the agent's cores, floor of 2 - the e2e suite spends most of its time
	// waiting on the browser/server rather than burning CPU, so a worker per core
	// is a better fit than the half-cores default
	workers: isCi ? Math.max(2, cpus().length) : undefined,
	reporter: isCi ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure'
	},
	webServer: {
		command: 'node --experimental-strip-types scripts/e2e-server.mjs',
		url: baseURL,
		reuseExistingServer: !isCi,
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
			use: {
				...devices['Desktop Firefox'],
				// undefined off macOS, where the launch env just defaults to process.env
				launchOptions: { env: firefoxLaunchEnv }
			}
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
