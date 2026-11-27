import { runBuild } from '@planning-inspectorate/core/util';
import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadBuildConfig } from '../app/config.ts';
import { fingerprintAndCompressStaticAssets } from './fingerprint-assets.ts';
import { emitFingerprintedStyleCss } from './minify-assets.ts';
import { copyDefraVendorEntryAssets, writeVendorCompressionSidecars } from './vendor-assets.ts';

/**
 * Do all steps to run the build
 */
async function run(): Promise<void> {
	const require = createRequire(import.meta.url);
	// resolves to <root>/node_modules/govuk-frontend/dist/govuk/all.bundle.js than maps to `<root>`
	const repoRoot = path.resolve(require.resolve('govuk-frontend'), '../../../../..');
	// resolves to <root>/node_modules/accessible-autocomplete/dist/*.js than maps to `dist`
	const accessibleAutocompleteRoot = path.resolve(require.resolve('accessible-autocomplete'), '..');

	const config = loadBuildConfig();
	// Do not pass localsFile: pages resolve fingerprinted names from
	// asset-manifest.json at boot. Rewriting config-middleware.ts would create
	// a second copy of hashes in git that drifts from the manifest.
	await runBuild({
		staticDir: config.staticDir,
		srcDir: config.srcDir,
		repoRoot,
		accessibleAutocompleteRoot
	});

	// Replace core's compressed style-{hash}.css with expand → hash(unminified) →
	// lightningcss minify so the style fingerprint matches the minify pipeline.
	await emitFingerprintedStyleCss({
		staticDir: config.staticDir,
		srcDir: config.srcDir,
		repoRoot
	});

	const javascriptsSource = path.join(config.srcDir, 'public', 'javascripts');
	const javascriptsDestination = path.join(config.staticDir, 'javascripts');
	await rm(javascriptsDestination, { recursive: true, force: true });
	await mkdir(javascriptsDestination, { recursive: true });
	await cp(javascriptsSource, javascriptsDestination, {
		recursive: true,
		filter: (source) => !source.endsWith('.test.js')
	});

	// Defra vendor entry points (index.js / index.css) are copied in so the
	// fingerprint pipeline renames them; webpack lazy chunks keep stable names
	// and stay on the /vendor express.static mounts
	await copyDefraVendorEntryAssets(config.staticDir);

	await fingerprintAndCompressStaticAssets(config.staticDir);
	// vendor lazy chunks keep stable names and stay in node_modules, so their
	// sidecars are written beside them - a package update then replaces files
	// and sidecars together and a stale variant can never be served
	await writeVendorCompressionSidecars();
}

// run the build, and write any errors to console
run().catch((err) => {
	console.error(err);
	throw err;
});
