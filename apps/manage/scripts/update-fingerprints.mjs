/**
 * `npm run update-fingerprints`: regenerate the asset fingerprints in
 * src/util/config-middleware.ts after changing CSS or JavaScript that ships to the
 * browser (src/app/sass/**, src/public/javascripts/**).
 *
 * `npm run check-fingerprints` (--check): the same build, then fail when any bound
 * literal in the COMMITTED config-middleware.ts differs from the fresh manifest.
 * The build rewrites stale literals in place, so the check compares `git show
 * HEAD:` content - what CI checked out - to the manifest the build just wrote.
 * CI runs this so a PR cannot merge stale checked-in fingerprints; run it locally
 * the same way (it validates the last commit, so commit a regeneration first).
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
import { loadAssetManifest, staleLocalsAssetPaths } from '../src/util/fingerprint-assets.ts';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localsFile = path.join('src', 'util', 'config-middleware.ts');
const checkOnly = process.argv.includes('--check');

const build = spawnSync(process.execPath, ['src/util/build.ts'], { cwd: appRoot, stdio: 'inherit' });
if (build.status !== 0) {
	process.exit(build.status ?? 1);
}

if (checkOnly) {
	// compare the committed file, not the working copy the build just rewrote -
	// otherwise a stale literal is repaired before it can be detected
	const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: appRoot, encoding: 'utf8' });
	const repoPath = root.status === 0 ? path.relative(root.stdout.trim(), path.join(appRoot, localsFile)) : localsFile;
	const committed = spawnSync('git', ['show', `HEAD:${repoPath.split(path.sep).join('/')}`], {
		cwd: appRoot,
		encoding: 'utf8'
	});
	if (committed.status !== 0) {
		console.error(`\nCannot read committed ${localsFile} (git show failed) - cannot verify fingerprints.`);
		process.exit(1);
	}
	const manifest = loadAssetManifest(path.join(appRoot, 'src', '.static'));
	const stale = manifest ? staleLocalsAssetPaths(committed.stdout, manifest) : ['(manifest missing)'];
	if (stale.length) {
		console.error(
			`\nCommitted ${localsFile} is out of date — these literals differ from a fresh build's manifest:\n` +
				`  ${stale.join(', ')}\n` +
				'Commit the regenerated file with the CSS/JavaScript change.'
		);
		process.exit(1);
	}
	console.log('\nCommitted asset fingerprints match a fresh build — nothing new to commit.');
	process.exit(0);
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
