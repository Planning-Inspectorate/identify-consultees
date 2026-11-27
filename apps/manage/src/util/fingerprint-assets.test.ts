import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import {
	ASSET_MANIFEST_FILENAME,
	ensureEmptyStaticMountDir,
	fingerprintAndCompressStaticAssets,
	isFingerprintedAssetPath,
	loadAssetManifest,
	missingManifestBindings,
	shouldCompress,
	shouldFingerprint
} from './fingerprint-assets.ts';

describe('fingerprint-assets', () => {
	/** @type {string | undefined} */
	let tempDir;

	after(async () => {
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	test('isFingerprintedAssetPath detects content-hashed filenames', () => {
		assert.equal(isFingerprintedAssetPath('style-635ae645.css'), true);
		assert.equal(isFingerprintedAssetPath('govuk-frontend.min-abcdef12.js'), true);
		assert.equal(isFingerprintedAssetPath('govuk-frontend.min-abcdef12.js.br'), true);
		assert.equal(isFingerprintedAssetPath('govuk-frontend.min-abcdef12.js.gz'), true);
		assert.equal(isFingerprintedAssetPath('govuk-frontend.min.js'), false);
		assert.equal(isFingerprintedAssetPath('style.css'), false);
	});

	test('shouldFingerprint and shouldCompress guard sidecars', () => {
		assert.equal(shouldFingerprint('javascripts/app.js.br'), false);
		assert.equal(shouldFingerprint('javascripts/app.js.gz'), false);
		assert.equal(shouldFingerprint('javascripts/app.test.js'), false);
		assert.equal(shouldFingerprint('javascripts/app.test.mjs'), false);
		assert.equal(shouldFingerprint('javascripts/app-aabbccdd.js'), false);
		assert.equal(shouldFingerprint('javascripts/app.js'), true);
		// .mjs plugin modules import each other - an unfingerprinted one can serve
		// stale against a new importer and break module linking for the whole graph
		assert.equal(shouldFingerprint('javascripts/plugin.mjs'), true);
		// vendor bundle entry points are fingerprinted, but webpack lazy chunks
		// keep stable names (they are referenced by literal filename at runtime)
		assert.equal(shouldFingerprint('vendor/datasets-plugin/js/index.js'), true);
		assert.equal(shouldFingerprint('vendor/datasets-plugin/css/index.css'), true);
		assert.equal(shouldFingerprint('vendor/datasets-plugin/js/6924.js'), false);
		assert.equal(shouldFingerprint('vendor/datasets-plugin/js/index-01234567.js'), false);
		assert.equal(shouldCompress('style.css.br'), false);
		assert.equal(shouldCompress('style.css.gz'), false);
		assert.equal(shouldCompress('style.css'), true);
		assert.equal(shouldCompress('image.png'), false);
	});

	test('fingerprintAndCompressStaticAssets hashes JS/CSS and writes br/gzip sidecars', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'fingerprint-assets-'));
		await mkdir(path.join(tempDir, 'assets', 'js'), { recursive: true });
		await mkdir(path.join(tempDir, 'assets', 'images'), { recursive: true });
		await mkdir(path.join(tempDir, 'javascripts'), { recursive: true });
		await writeFile(path.join(tempDir, 'assets', 'js', 'govuk-frontend.min.js'), 'console.log("govuk");\n');
		// whitespace-heavy so minify clears the ≥64 byte / ≥1% savings threshold
		const paddedMap = `export const ok = true;\nexport function describeMap() {\n  return {\n${'    label: "consultee map label",\n'.repeat(20)}  };\n}\n`;
		const paddedApp = `export const demo = true;\nexport function describeApp() {\n  return {\n${'    label: "example app label",\n'.repeat(20)}  };\n}\n`;
		await writeFile(path.join(tempDir, 'javascripts', 'consultees-map.js'), paddedMap);
		await writeFile(path.join(tempDir, 'javascripts', 'example-app.js'), paddedApp);
		await writeFile(path.join(tempDir, 'style-aabbccdd.css'), 'body{color:red}');
		await writeFile(path.join(tempDir, 'assets', 'images', 'keep.png'), Buffer.from([1, 2, 3]));
		await mkdir(path.join(tempDir, 'vendor', 'map-key-plugin', 'js'), { recursive: true });
		await mkdir(path.join(tempDir, 'vendor', 'map-key-plugin', 'css'), { recursive: true });
		// already-tight vendor entry: minify candidate is not smaller, so bytes stay
		await writeFile(path.join(tempDir, 'vendor', 'map-key-plugin', 'js', 'index.js'), 'globalThis.mkp={};\n');
		await writeFile(path.join(tempDir, 'vendor', 'map-key-plugin', 'css', 'index.css'), 'a{color:red}\n');
		await writeFile(path.join(tempDir, 'vendor', 'map-key-plugin', 'js', '6924.js'), 'globalThis.chunk = {};\n');

		const manifest = await fingerprintAndCompressStaticAssets(tempDir);

		assert.match(manifest.assets['assets/js/govuk-frontend.min.js'], /govuk-frontend\.min-[0-9a-f]{8}\.js/);
		assert.match(manifest.assets['javascripts/consultees-map.js'], /consultees-map-[0-9a-f]{8}\.js/);
		assert.match(manifest.assets['javascripts/example-app.js'], /example-app-[0-9a-f]{8}\.js/);
		assert.equal(manifest.assets['style.css'], 'style-aabbccdd.css');
		assert.match(manifest.assets['vendor/map-key-plugin/js/index.js'], /index-[0-9a-f]{8}\.js/);
		assert.match(manifest.assets['vendor/map-key-plugin/css/index.css'], /index-[0-9a-f]{8}\.css/);
		assert.equal(manifest.assets['vendor/map-key-plugin/js/6924.js'], undefined);
		const vendorJs = await readFile(
			path.join(tempDir, ...manifest.assets['vendor/map-key-plugin/js/index.js'].split('/')),
			'utf8'
		);
		assert.equal(vendorJs, 'globalThis.mkp={};\n');

		const hashedGovuk = path.join(tempDir, ...manifest.assets['assets/js/govuk-frontend.min.js'].split('/'));
		const brBody = await readFile(`${hashedGovuk}.br`);
		assert.ok(brBody.byteLength > 0);
		// already-.min assets are not re-minified — bytes match the source copy
		assert.deepEqual(brotliDecompressSync(brBody).toString(), 'console.log("govuk");\n');
		assert.deepEqual(gunzipSync(await readFile(`${hashedGovuk}.gz`)).toString(), 'console.log("govuk");\n');

		// first-party JS is minified before Brotli when savings clear the threshold
		const hashedMap = path.join(tempDir, ...manifest.assets['javascripts/consultees-map.js'].split('/'));
		const mapBody = brotliDecompressSync(await readFile(`${hashedMap}.br`)).toString();
		assert.ok(mapBody.includes('ok'));
		assert.ok(mapBody.includes('export'));
		assert.ok(mapBody.length < paddedMap.length, 'padded source should minify below the unminified size');

		// unfingerprinted compressible files get sidecars too - favicons, manifests
		// and other files the fingerprint globs do not cover
		const styleGz = gunzipSync(await readFile(path.join(tempDir, 'style-aabbccdd.css.gz')));
		assert.equal(styleGz.toString(), 'body{color:red}');
		const manifestGz = gunzipSync(await readFile(path.join(tempDir, 'asset-manifest.json.gz')));
		assert.ok(manifestGz.byteLength > 0);

		const writtenManifest = JSON.parse(await readFile(path.join(tempDir, 'asset-manifest.json'), 'utf8'));
		assert.deepEqual(writtenManifest.assets['style.css'], 'style-aabbccdd.css');
	});

	test('fingerprintAndCompressStaticAssets reuses previous sidecars and clears orphans', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'fingerprint-reuse-'));
		await mkdir(path.join(tempDir, 'javascripts'), { recursive: true });
		await writeFile(path.join(tempDir, 'javascripts', 'app.js'), 'export const a = 1;\n');
		const readme = path.join(tempDir, 'readme.txt');
		await writeFile(readme, 'version one\n');
		// an orphan sidecar: its base file is gone before the build even starts
		await writeFile(path.join(tempDir, 'ghost.css.br'), 'stale');

		const first = await fingerprintAndCompressStaticAssets(tempDir);
		const appPath = path.join(tempDir, ...first.assets['javascripts/app.js'].split('/'));
		const brMtime = (await stat(`${appPath}.br`)).mtimeMs;
		const gzMtime = (await stat(`${appPath}.gz`)).mtimeMs;

		// a rebuild re-copies sources (identical content, fresh mtimes), and the
		// one unfingerprinted file changed - only its sidecars must be rebuilt
		await writeFile(path.join(tempDir, 'javascripts', 'app.js'), 'export const a = 1;\n');
		await writeFile(readme, 'version two, longer\n');
		const future = new Date(Date.now() + 60_000);
		await utimes(readme, future, future);

		const second = await fingerprintAndCompressStaticAssets(tempDir);
		assert.deepEqual(second.assets, first.assets);

		// the content-addressed name pins the bytes, so its existing sidecars
		// are reused untouched rather than re-encoded
		assert.equal((await stat(`${appPath}.br`)).mtimeMs, brMtime);
		assert.equal((await stat(`${appPath}.gz`)).mtimeMs, gzMtime);
		// the orphan is swept, and the changed file was recompressed
		await assert.rejects(stat(path.join(tempDir, 'ghost.css.br')));
		assert.equal(gunzipSync(await readFile(`${readme}.gz`)).toString(), 'version two, longer\n');
	});

	test('fingerprintAndCompressStaticAssets fingerprints .mjs modules and rewrites specifiers', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'fingerprint-modules-'));
		await mkdir(path.join(tempDir, 'javascripts'), { recursive: true });
		await mkdir(path.join(tempDir, 'assets', 'js'), { recursive: true });
		await mkdir(path.join(tempDir, 'assets', 'css'), { recursive: true });
		// app -> plugin -> dep and app -> dep: the diamond makes the import order
		// matter - dep's hashed name must exist before either importer is hashed
		await writeFile(
			path.join(tempDir, 'javascripts', 'app.js'),
			"import { createPlugin } from './plugin.mjs';\n" +
				"import { dep } from './dep.mjs';\n" +
				"import './side.mjs';\n" +
				"const lazy = import('./lazy.mjs');\n" +
				"const plain = './data.json';\n" +
				'export { createPlugin, dep, lazy, plain };\n'
		);
		await writeFile(
			path.join(tempDir, 'javascripts', 'plugin.mjs'),
			"import { dep } from './dep.mjs';\nimport './data.json';\nexport const createPlugin = () => dep;\n"
		);
		await writeFile(
			path.join(tempDir, 'javascripts', 'up.mjs'),
			"import '../assets/js/lib.js';\nexport const up = 1;\n"
		);
		await writeFile(path.join(tempDir, 'assets', 'js', 'lib.js'), 'globalThis.lib = {};\n');
		await writeFile(path.join(tempDir, 'assets', 'css', 'site.css'), 'body { margin: 0; }\n');
		await writeFile(path.join(tempDir, 'javascripts', 'dep.mjs'), 'export const dep = 1;\n');
		await writeFile(path.join(tempDir, 'javascripts', 'side.mjs'), 'globalThis.side = true;\n');
		await writeFile(path.join(tempDir, 'javascripts', 'lazy.mjs'), 'export const lazy = true;\n');
		await writeFile(path.join(tempDir, 'javascripts', 'data.json'), '{}');

		const manifest = await fingerprintAndCompressStaticAssets(tempDir);
		const app = manifest.assets['javascripts/app.js'];
		const plugin = manifest.assets['javascripts/plugin.mjs'];
		const dep = manifest.assets['javascripts/dep.mjs'];
		const side = manifest.assets['javascripts/side.mjs'];
		const lazy = manifest.assets['javascripts/lazy.mjs'];
		const up = manifest.assets['javascripts/up.mjs'];
		const lib = manifest.assets['assets/js/lib.js'];
		const site = manifest.assets['assets/css/site.css'];

		assert.match(app, /^javascripts\/app-[0-9a-f]{8}\.js$/);
		assert.match(plugin, /^javascripts\/plugin-[0-9a-f]{8}\.mjs$/);
		assert.match(dep, /^javascripts\/dep-[0-9a-f]{8}\.mjs$/);
		assert.match(side, /^javascripts\/side-[0-9a-f]{8}\.mjs$/);
		assert.match(lazy, /^javascripts\/lazy-[0-9a-f]{8}\.mjs$/);
		assert.match(up, /^javascripts\/up-[0-9a-f]{8}\.mjs$/);
		assert.match(lib, /^assets\/js\/lib-[0-9a-f]{8}\.js$/);
		assert.match(site, /^assets\/css\/site-[0-9a-f]{8}\.css$/);
		assert.equal(manifest.assets['javascripts/data.json'], undefined);

		// every specifier targeting a fingerprinted file resolves to the hashed name
		// (minify may rewrite quote style / spacing, so match the hashed basename)
		const appContent = await readFile(path.join(tempDir, ...app.split('/')), 'utf8');
		const pluginContent = await readFile(path.join(tempDir, ...plugin.split('/')), 'utf8');
		const upContent = await readFile(path.join(tempDir, ...up.split('/')), 'utf8');
		assert.ok(appContent.includes(path.posix.basename(plugin)));
		assert.ok(appContent.includes(path.posix.basename(dep)));
		assert.ok(appContent.includes(path.posix.basename(side)));
		assert.ok(appContent.includes(path.posix.basename(lazy)));
		assert.ok(!appContent.includes('plugin.mjs') || appContent.includes(path.posix.basename(plugin)));
		assert.ok(!appContent.includes("'./plugin.mjs'"));
		assert.ok(pluginContent.includes(path.posix.basename(dep)));
		assert.ok(!pluginContent.includes("'./dep.mjs'"));
		assert.ok(upContent.includes(path.posix.basename(lib)));

		// specifiers outside the fingerprinted set, and plain strings, stay as written
		assert.ok(appContent.includes('./data.json') || appContent.includes('"./data.json"'));
		assert.ok(pluginContent.includes('./data.json') || pluginContent.includes('"./data.json"'));

		// fingerprinted .mjs files get the same Brotli sidecar as fingerprinted .js
		const brBody = await readFile(`${path.join(tempDir, ...dep.split('/'))}.br`);
		assert.ok(brBody.byteLength > 0);
	});

	test('fingerprintAndCompressStaticAssets keeps unminified bytes when minify throws', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'fingerprint-minify-fail-'));
		await mkdir(path.join(tempDir, 'javascripts'), { recursive: true });
		const source = 'export const a = 1;\nexport const a = 2;\n';
		await writeFile(path.join(tempDir, 'javascripts', 'broken.js'), source);

		const manifest = await fingerprintAndCompressStaticAssets(tempDir);
		const hashed = path.join(tempDir, ...manifest.assets['javascripts/broken.js'].split('/'));
		assert.equal(await readFile(hashed, 'utf8'), source);
	});

	test('fingerprintAndCompressStaticAssets rejects circular imports between fingerprinted modules', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'fingerprint-cycle-'));
		await mkdir(path.join(tempDir, 'javascripts'), { recursive: true });
		await writeFile(path.join(tempDir, 'javascripts', 'a.mjs'), "import './b.mjs';\nexport const a = 1;\n");
		await writeFile(path.join(tempDir, 'javascripts', 'b.mjs'), "import './a.mjs';\nexport const b = 1;\n");

		await assert.rejects(() => fingerprintAndCompressStaticAssets(tempDir), /circular import/);
	});

	test('fingerprintAndCompressStaticAssets skips test files, sidecars, and already-hashed assets', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'fingerprint-skip-'));
		await mkdir(path.join(tempDir, 'javascripts'), { recursive: true });
		await writeFile(path.join(tempDir, 'javascripts', 'example-app.test.js'), 'export const test = true;\n');
		await writeFile(path.join(tempDir, 'javascripts', 'already-aabbccdd.js'), 'export const hashed = true;\n');
		await writeFile(path.join(tempDir, 'javascripts', 'already-aabbccdd.js.br'), 'br');
		await writeFile(path.join(tempDir, 'readme.txt'), 'plain text');

		const manifest = await fingerprintAndCompressStaticAssets(tempDir);
		assert.equal(manifest.assets['javascripts/example-app.test.js'], undefined);
		assert.equal(manifest.assets['javascripts/already-aabbccdd.js'], undefined);
		assert.equal(manifest.assets['readme.txt'], undefined);
	});

	test('loadAssetManifest reads the manifest a build wrote', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'fingerprint-load-'));
		const manifest = { assets: { 'javascripts/app.js': 'javascripts/app-01234567.js' } };
		await writeFile(path.join(tempDir, ASSET_MANIFEST_FILENAME), JSON.stringify(manifest));

		assert.deepEqual(loadAssetManifest(tempDir), manifest);
	});

	test('loadAssetManifest returns null for missing, malformed or shapeless manifests', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'fingerprint-load-bad-'));
		assert.equal(loadAssetManifest(tempDir), null);

		const manifestPath = path.join(tempDir, ASSET_MANIFEST_FILENAME);
		await writeFile(manifestPath, 'not json');
		assert.equal(loadAssetManifest(tempDir), null);

		await writeFile(manifestPath, JSON.stringify({ notAssets: true }));
		assert.equal(loadAssetManifest(tempDir), null);

		await writeFile(manifestPath, 'null');
		assert.equal(loadAssetManifest(tempDir), null);
	});

	test('missingManifestBindings flags absent keys and missing on-disk files', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'fingerprint-bindings-'));
		assert.deepEqual((await missingManifestBindings(tempDir, null)).slice(0, 2), ['styleFile', 'govukFrontendJs']);

		const hashedStyle = 'style-11111111.css';
		await writeFile(path.join(tempDir, hashedStyle), 'body{}');
		const missing = await missingManifestBindings(tempDir, {
			assets: {
				'style.css': hashedStyle,
				'assets/js/govuk-frontend.min.js': 'assets/js/govuk-frontend.min-22222222.js'
			}
		});
		assert.ok(!missing.includes('styleFile'));
		assert.ok(missing.includes('govukFrontendJs'));
		assert.ok(missing.includes('consulteesMapJs'));
	});

	test('ensureEmptyStaticMountDir recreates an empty directory', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'empty-mount-'));
		const nested = path.join(tempDir, 'child.txt');
		await writeFile(nested, 'x');
		await ensureEmptyStaticMountDir(tempDir);
		const stats = await stat(tempDir);
		assert.equal(stats.isDirectory(), true);
	});
});
