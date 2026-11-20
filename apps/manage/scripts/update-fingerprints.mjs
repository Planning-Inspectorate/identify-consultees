/**
 * `npm run update-fingerprints`: regenerate the asset fingerprints in
 * src/util/config-middleware.ts after changing CSS or JavaScript that ships to the
 * browser (src/app/sass/**, src/public/javascripts/**).
 *
 * The fingerprinted filenames are content hashes of the *built* files, so this
 * runs the full asset build (src/util/build.ts) — hashing src/.static without
 * rebuilding it would fingerprint stale output. The build rewrites the manifest
 * literals in config-middleware.ts in place; this script then reports whether the
 * file changed, because the new hashes must be committed with the source change —
 * uncommitted, the app keeps requesting the old fingerprinted files and the change
 * is never served.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localsFile = path.join('src', 'util', 'config-middleware.ts');

const build = spawnSync(process.execPath, ['src/util/build.ts'], { cwd: appRoot, stdio: 'inherit' });
if (build.status !== 0) {
	process.exit(build.status ?? 1);
}

const status = spawnSync('git', ['status', '--porcelain', '--', localsFile], { cwd: appRoot, encoding: 'utf8' });
if (status.status !== 0) {
	console.log(`\nIf ${localsFile} changed, commit it with the CSS/JavaScript change.`);
} else if (status.stdout.trim()) {
	console.log(
		`\n${localsFile} now holds the new asset fingerprints — commit it in the same PR as the ` +
			'CSS/JavaScript change. If it is not committed, hosting environments keep requesting ' +
			'the old fingerprinted files and the change is never served.'
	);
} else {
	console.log('\nAsset fingerprints unchanged — nothing new to commit.');
}
