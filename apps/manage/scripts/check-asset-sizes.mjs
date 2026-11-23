/**
 * Fail when a fingerprinted asset outgrows its size budget, or when a manifest
 * entry points at a file that is not on disk.
 *
 * The manifest only lists entry points - vendor webpack chunks etc. ride inside
 * their bundle's budget. Budgets are tripwires, not contracts: each leaves
 * roughly 50% headroom over the current size so a dependency or bundling
 * accident (a whole library pulled into one module) trips loudly, while normal
 * growth does not. Raise one deliberately, with the change justified in the PR.
 *
 * Run after `npm run build` - .static is gitignored so there is nothing to
 * check until a build has produced it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const staticDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', '.static');
const manifestPath = path.join(staticDir, 'asset-manifest.json');

if (!fs.existsSync(manifestPath)) {
	console.error(`No ${manifestPath} - run npm run build first.`);
	process.exit(1);
}

const KIB = 1024;
const DEFAULT_BUDGET_BYTES = 40 * KIB;

// current sizes: style.css 143KB, accessible-autocomplete 54KB,
// interactive-map.css 52KB, govuk-frontend.min.js 46KB, interactive-map.js 45KB,
// everything else < 30KB
const BUDGETS = {
	'style.css': 220 * KIB,
	'assets/js/accessible-autocomplete.min.js': 90 * KIB,
	'vendor/interactive-map/css/index.css': 80 * KIB,
	'vendor/interactive-map/js/index.js': 70 * KIB,
	'assets/js/govuk-frontend.min.js': 70 * KIB
};

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const failures = [];

for (const [logical, hashed] of Object.entries(manifest.assets)) {
	const absolute = path.join(staticDir, hashed);
	if (!fs.existsSync(absolute)) {
		failures.push(`${logical}: ${hashed} is missing from ${staticDir}`);
		continue;
	}
	const size = fs.statSync(absolute).size;
	const budget = BUDGETS[logical] ?? DEFAULT_BUDGET_BYTES;
	if (size > budget) {
		failures.push(`${logical} (${hashed}): ${(size / KIB).toFixed(1)}KB exceeds its ${budget / KIB}KB budget`);
	}
}

if (failures.length > 0) {
	console.error(
		`Asset size problems:\n  ${failures.join('\n  ')}\nShrink the asset or raise its budget in scripts/check-asset-sizes.mjs deliberately.`
	);
	process.exit(1);
}

console.log(`All ${Object.keys(manifest.assets).length} manifest assets present and within size budgets.`);
