/**
 * `npm run update-fingerprints` / `npm run check-fingerprints` (--check):
 * run the full asset build, then verify every LOCALS_ASSET_BINDINGS entry is
 * present in `src/.static/asset-manifest.json` with the fingerprinted file on
 * disk. Pages resolve hashes from that manifest at boot — there are no
 * committed hashed literals in config-middleware.ts to regenerate.
 *
 * The fingerprinted filenames are content hashes of the *built* files, so this
 * always runs the full asset build (src/util/build.ts).
 */
import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAssetManifest, missingManifestBindings } from '../src/util/fingerprint-assets.ts';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = path.join(appRoot, 'src', '.static');
const checkOnly = process.argv.includes('--check');

const build = spawnSync(process.execPath, ['src/util/build.ts'], { cwd: appRoot, stdio: 'inherit' });
if (build.status !== 0) {
	process.exit(build.status ?? 1);
}

const manifest = loadAssetManifest(staticDir);
const missing = await missingManifestBindings(staticDir, manifest);

if (missing.length) {
	console.error(
		`\nAsset manifest is incomplete after a fresh build — missing or on-disk-absent bindings:\n` +
			`  ${missing.join(', ')}\n` +
			'Fix the build so every LOCALS_ASSET_BINDINGS logical path is fingerprinted into asset-manifest.json.'
	);
	process.exit(1);
}

try {
	await access(path.join(staticDir, 'asset-manifest.json'));
} catch {
	console.error('\nasset-manifest.json missing after build.');
	process.exit(1);
}

if (checkOnly) {
	console.log('\nAsset manifest includes every bound path with files on disk — fingerprints OK.');
	process.exit(0);
}

console.log(
	'\nAsset build complete. Pages resolve fingerprinted names from src/.static/asset-manifest.json at boot — nothing to commit for hashes.'
);
