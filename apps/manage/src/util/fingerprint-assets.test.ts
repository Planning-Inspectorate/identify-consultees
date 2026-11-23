import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import {
	ASSET_MANIFEST_FILENAME,
	applyAssetManifestToLocalsFile,
	ensureEmptyStaticMountDir,
	fingerprintAndCompressStaticAssets,
	isFingerprintedAssetPath,
	loadAssetManifest,
	shouldBrotli,
	shouldFingerprint,
	staleLocalsAssetPaths
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
		assert.equal(isFingerprintedAssetPath('govuk-frontend.min.js'), false);
		assert.equal(isFingerprintedAssetPath('style.css'), false);
	});

	test('shouldFingerprint and shouldBrotli guard sidecars', () => {
		assert.equal(shouldFingerprint('javascripts/app.js.br'), false);
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
		assert.equal(shouldBrotli('style.css.br'), false);
		assert.equal(shouldBrotli('style.css'), true);
		assert.equal(shouldBrotli('image.png'), false);
	});

	test('fingerprintAndCompressStaticAssets hashes JS/CSS and writes Brotli sidecars', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'fingerprint-assets-'));
		await mkdir(path.join(tempDir, 'assets', 'js'), { recursive: true });
		await mkdir(path.join(tempDir, 'assets', 'images'), { recursive: true });
		await mkdir(path.join(tempDir, 'javascripts'), { recursive: true });
		await writeFile(path.join(tempDir, 'assets', 'js', 'govuk-frontend.min.js'), 'console.log("govuk");\n');
		await writeFile(path.join(tempDir, 'javascripts', 'consultees-map.js'), 'export const ok = true;\n');
		await writeFile(path.join(tempDir, 'javascripts', 'example-app.js'), 'export const demo = true;\n');
		await writeFile(path.join(tempDir, 'style-aabbccdd.css'), 'body{color:red}');
		await writeFile(path.join(tempDir, 'assets', 'images', 'keep.png'), Buffer.from([1, 2, 3]));
		await mkdir(path.join(tempDir, 'vendor', 'map-key-plugin', 'js'), { recursive: true });
		await writeFile(path.join(tempDir, 'vendor', 'map-key-plugin', 'js', 'index.js'), 'globalThis.mkp = {};\n');
		await writeFile(path.join(tempDir, 'vendor', 'map-key-plugin', 'js', '6924.js'), 'globalThis.chunk = {};\n');

		const manifest = await fingerprintAndCompressStaticAssets(tempDir);

		assert.match(manifest.assets['assets/js/govuk-frontend.min.js'], /govuk-frontend\.min-[0-9a-f]{8}\.js/);
		assert.match(manifest.assets['javascripts/consultees-map.js'], /consultees-map-[0-9a-f]{8}\.js/);
		assert.match(manifest.assets['javascripts/example-app.js'], /example-app-[0-9a-f]{8}\.js/);
		assert.equal(manifest.assets['style.css'], 'style-aabbccdd.css');
		assert.match(manifest.assets['vendor/map-key-plugin/js/index.js'], /index-[0-9a-f]{8}\.js/);
		assert.equal(manifest.assets['vendor/map-key-plugin/js/6924.js'], undefined);

		const hashedGovuk = path.join(tempDir, ...manifest.assets['assets/js/govuk-frontend.min.js'].split('/'));
		const brBody = await readFile(`${hashedGovuk}.br`);
		assert.ok(brBody.byteLength > 0);

		const writtenManifest = JSON.parse(await readFile(path.join(tempDir, 'asset-manifest.json'), 'utf8'));
		assert.deepEqual(writtenManifest.assets['style.css'], 'style-aabbccdd.css');
	});

	test('applyAssetManifestToLocalsFile rewrites asset path literals', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'fingerprint-locals-'));
		const localsFile = path.join(tempDir, 'config-middleware.ts');
		await writeFile(
			localsFile,
			`export function addLocalsConfiguration() {
	return (req, res, next) => {
		res.locals.config = {
			styleFile: 'style.css',
			govukFrontendJs: 'assets/js/govuk-frontend.min.js',
			consulteesMapJs: 'javascripts/consultees-map.js',
			blobUploadJs: 'javascripts/blob-upload.js',
			vendorMapKeyPluginJs: 'vendor/map-key-plugin/js/index.js',
			headerTitle: 'Identify consultees',
			footerLinks: []
		};
		next();
	};
}
`
		);

		await applyAssetManifestToLocalsFile(localsFile, {
			assets: {
				'style.css': 'style-deadbeef.css',
				'assets/js/govuk-frontend.min.js': 'assets/js/govuk-frontend.min-cafebabe.js',
				'javascripts/consultees-map.js': 'javascripts/consultees-map-01234567.js',
				'javascripts/blob-upload.js': 'javascripts/blob-upload-89abcdef.js',
				'vendor/map-key-plugin/js/index.js': 'vendor/map-key-plugin/js/index-13579bdf.js'
			}
		});

		const updated = await readFile(localsFile, 'utf8');
		assert.match(updated, /styleFile: 'style-deadbeef\.css'/);
		assert.match(updated, /govukFrontendJs: 'assets\/js\/govuk-frontend\.min-cafebabe\.js'/);
		assert.match(updated, /consulteesMapJs: 'javascripts\/consultees-map-01234567\.js'/);
		assert.match(updated, /blobUploadJs: 'javascripts\/blob-upload-89abcdef\.js'/);
		assert.match(updated, /vendorMapKeyPluginJs: 'vendor\/map-key-plugin\/js\/index-13579bdf\.js'/);
	});

	test('applyAssetManifestToLocalsFile leaves an unchanged file untouched', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'fingerprint-locals-'));
		const localsFile = path.join(tempDir, 'config-middleware.ts');
		const source = `export const config = { styleFile: 'style-deadbeef.css' };\n`;
		await writeFile(localsFile, source);
		const { mtimeMs: before } = await stat(localsFile);

		await applyAssetManifestToLocalsFile(localsFile, { assets: { 'style.css': 'style-deadbeef.css' } });

		assert.equal((await stat(localsFile)).mtimeMs, before);
		assert.equal(await readFile(localsFile, 'utf8'), source);
	});

	test('applyAssetManifestToLocalsFile rejects an empty locals file', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'fingerprint-locals-'));
		const localsFile = path.join(tempDir, 'config-middleware.ts');
		await writeFile(localsFile, '');

		await assert.rejects(
			applyAssetManifestToLocalsFile(localsFile, { assets: { 'style.css': 'style-deadbeef.css' } }),
			/is empty.*Restore it/s
		);
		assert.equal(await readFile(localsFile, 'utf8'), '');
	});

	test('applyAssetManifestToLocalsFile rejects a torn file missing bound literals', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'fingerprint-locals-'));
		const localsFile = path.join(tempDir, 'config-middleware.ts');
		// every bound literal except styleFile is gone - the shape a truncated
		// write leaves behind
		await writeFile(localsFile, `export const config = { styleFile: 'style-old.css' };\n`);

		await assert.rejects(
			applyAssetManifestToLocalsFile(localsFile, {
				assets: {
					'style.css': 'style-deadbeef.css',
					'javascripts/consultees-map.js': 'javascripts/consultees-map-01234567.js'
				}
			}),
			/missing asset literals for consulteesMapJs.*Restore it/s
		);
		assert.match(await readFile(localsFile, 'utf8'), /style-old\.css/);
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
		const appContent = await readFile(path.join(tempDir, ...app.split('/')), 'utf8');
		const pluginContent = await readFile(path.join(tempDir, ...plugin.split('/')), 'utf8');
		const upContent = await readFile(path.join(tempDir, ...up.split('/')), 'utf8');
		assert.ok(appContent.includes(`from './${path.posix.basename(plugin)}'`));
		assert.ok(appContent.includes(`from './${path.posix.basename(dep)}'`));
		assert.ok(appContent.includes(`import './${path.posix.basename(side)}'`));
		assert.ok(appContent.includes(`import('./${path.posix.basename(lazy)}')`));
		assert.ok(!appContent.includes("'./plugin.mjs'"));
		assert.ok(pluginContent.includes(`from './${path.posix.basename(dep)}'`));
		assert.ok(!pluginContent.includes("'./dep.mjs'"));
		// a cross-directory specifier keeps its ../ form, pointed at the hashed file
		assert.ok(upContent.includes(`import '${lib.replace('assets/', '../assets/')}'`));

		// specifiers outside the fingerprinted set, and plain strings, stay as written
		assert.ok(appContent.includes("'./data.json'"));
		assert.ok(pluginContent.includes("import './data.json'"));

		// fingerprinted .mjs files get the same Brotli sidecar as fingerprinted .js
		const brBody = await readFile(`${path.join(tempDir, ...dep.split('/'))}.br`);
		assert.ok(brBody.byteLength > 0);
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

	test('staleLocalsAssetPaths flags literals that differ from the manifest', () => {
		// consulteesMapJs has no literal at all - a missing property is stale too,
		// since the build rewrite can only update a literal that exists
		const content = `export const paths = {
	styleFile: 'style-11111111.css',
	govukFrontendJs: 'assets/js/govuk-frontend.min-22222222.js'
};
`;
		const manifest = {
			assets: {
				'style.css': 'style-11111111.css',
				'assets/js/govuk-frontend.min.js': 'assets/js/govuk-frontend.min-99999999.js',
				'javascripts/consultees-map.js': 'javascripts/consultees-map-99999999.js'
			}
		};

		const stale = staleLocalsAssetPaths(content, manifest);
		assert.ok(stale.includes('govukFrontendJs'));
		assert.ok(stale.includes('consulteesMapJs'));
		assert.ok(!stale.includes('styleFile'));

		// a literal whose binding the manifest no longer produces is stale too - a
		// dead property the file should not keep emitting
		const missingEntry = staleLocalsAssetPaths(content, {
			assets: { 'assets/js/govuk-frontend.min.js': 'assets/js/govuk-frontend.min-22222222.js' }
		});
		assert.ok(missingEntry.includes('styleFile'));
		assert.ok(!missingEntry.includes('govukFrontendJs'));
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
