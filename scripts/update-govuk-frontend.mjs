#!/usr/bin/env node
/**
 * `npm run deps:update-govuk-frontend` — update govuk-frontend to the latest
 * release and rebuild the fingerprinted frontend assets.
 *
 * What it does, in order:
 *   1. reports the installed version against the latest on npm
 *   2. `npm install govuk-frontend@latest` — updates `dependencies` and the lockfile
 *   3. syncs the `@defra/interactive-map` override to the same range, so the
 *      vendor map bundle keeps resolving to the one shared copy (package.json
 *      pins it explicitly because Defra's own range can lag ours)
 *   4. `npm install` to reconcile the lockfile when the override moved
 *   5. `npm run build` in apps/manage — the fingerprinted `style`/`govuk-frontend`
 *      assets and `config-middleware.ts` regenerate against the new version
 *
 * See docs/update-govuk-frontend.md for the review/commit steps that follow.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const PACKAGE_JSON = 'package.json';

const run = (args) => execFileSync('npm', args, { stdio: 'inherit' });
const out = (args) => execFileSync('npm', args, { encoding: 'utf8' }).trim();

const pkg = () => JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));

const installed = pkg().dependencies?.['govuk-frontend'];
const latest = out(['view', 'govuk-frontend', 'version']);
console.log(`govuk-frontend: ${installed ?? '(not installed)'} -> ${latest}`);

// updates dependencies.govuk-frontend to ^<latest> and refreshes the lockfile
run(['install', `govuk-frontend@^${latest}`]);

// the override must stay on the same range or npm installs two copies of the
// design system. Surgical edit keeps package.json's formatting.
const range = pkg().dependencies['govuk-frontend'];
const override = pkg().overrides?.['@defra/interactive-map']?.['govuk-frontend'];
if (override === undefined) {
	console.log('note: no @defra/interactive-map override in package.json - nothing to sync');
} else if (override === range) {
	console.log(`overrides.@defra/interactive-map.govuk-frontend already ${range}`);
} else {
	const source = readFileSync(PACKAGE_JSON, 'utf8');
	const pattern = /("@defra\/interactive-map"\s*:\s*\{[^}]*"govuk-frontend"\s*:\s*")[^"]*(")/;
	const updated = source.replace(pattern, `$1${range}$2`);
	if (updated === source) {
		throw new Error(`could not update the @defra/interactive-map override - edit package.json by hand`);
	}
	writeFileSync(PACKAGE_JSON, updated);
	console.log(`overrides.@defra/interactive-map.govuk-frontend ${override} -> ${range}`);
	run(['install']);
}

// fingerprinted style/asset names and config-middleware.ts regenerate from the new package
run(['run', 'build', '--workspace', 'identify-consultees-manage']);

console.log(`
govuk-frontend ${latest} installed and assets rebuilt.

Next steps:
  1. smoke-test a page and skim the release notes for visual changes
  2. npm run test-coverage
  3. commit package.json, package-lock.json and config-middleware.ts on a chore/ branch and open a PR
`);
