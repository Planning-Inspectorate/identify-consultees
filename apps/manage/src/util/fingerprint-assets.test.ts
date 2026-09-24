import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import {
	applyAssetManifestToLocalsFile,
	ensureEmptyStaticMountDir,
	fingerprintAndCompressStaticAssets,
	isFingerprintedAssetPath,
	shouldBrotliRelativePath,
	shouldFingerprintRelativePath
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

	test('shouldFingerprintRelativePath and shouldBrotliRelativePath guard sidecars', () => {
		assert.equal(shouldFingerprintRelativePath('javascripts/app.js.br'), false);
		assert.equal(shouldFingerprintRelativePath('javascripts/app.test.js'), false);
		assert.equal(shouldFingerprintRelativePath('javascripts/app-aabbccdd.js'), false);
		assert.equal(shouldFingerprintRelativePath('javascripts/app.js'), true);
		assert.equal(shouldBrotliRelativePath('style.css.br'), false);
		assert.equal(shouldBrotliRelativePath('style.css'), true);
		assert.equal(shouldBrotliRelativePath('image.png'), false);
	});

	test('fingerprintAndCompressStaticAssets hashes JS/CSS and writes Brotli sidecars', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'fingerprint-assets-'));
		await mkdir(path.join(tempDir, 'assets', 'js'), { recursive: true });
		await mkdir(path.join(tempDir, 'assets', 'images'), { recursive: true });
		await mkdir(path.join(tempDir, 'javascripts'), { recursive: true });
		await writeFile(path.join(tempDir, 'assets', 'js', 'govuk-frontend.min.js'), 'console.log("govuk");\n');
		await writeFile(path.join(tempDir, 'javascripts', 'consultees-map.js'), 'export const ok = true;\n');
		await writeFile(path.join(tempDir, 'javascripts', 'map-layers-demo.js'), 'export const demo = true;\n');
		await writeFile(path.join(tempDir, 'style-aabbccdd.css'), 'body{color:red}');
		await writeFile(path.join(tempDir, 'assets', 'images', 'keep.png'), Buffer.from([1, 2, 3]));

		const manifest = await fingerprintAndCompressStaticAssets(tempDir);

		assert.match(manifest.assets['assets/js/govuk-frontend.min.js'], /govuk-frontend\.min-[0-9a-f]{8}\.js/);
		assert.match(manifest.assets['javascripts/consultees-map.js'], /consultees-map-[0-9a-f]{8}\.js/);
		assert.match(manifest.assets['javascripts/map-layers-demo.js'], /map-layers-demo-[0-9a-f]{8}\.js/);
		assert.equal(manifest.assets['style.css'], 'style-aabbccdd.css');

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
			mapLayersDemoJs: 'javascripts/map-layers-demo.js',
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
				'javascripts/map-layers-demo.js': 'javascripts/map-layers-demo-89abcdef.js'
			}
		});

		const updated = await readFile(localsFile, 'utf8');
		assert.match(updated, /styleFile: 'style-deadbeef\.css'/);
		assert.match(updated, /govukFrontendJs: 'assets\/js\/govuk-frontend\.min-cafebabe\.js'/);
		assert.match(updated, /consulteesMapJs: 'javascripts\/consultees-map-01234567\.js'/);
		assert.match(updated, /mapLayersDemoJs: 'javascripts\/map-layers-demo-89abcdef\.js'/);
	});

	test('fingerprintAndCompressStaticAssets skips test files, sidecars, and already-hashed assets', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'fingerprint-skip-'));
		await mkdir(path.join(tempDir, 'javascripts'), { recursive: true });
		await writeFile(path.join(tempDir, 'javascripts', 'map-layers-demo.test.js'), 'export const test = true;\n');
		await writeFile(path.join(tempDir, 'javascripts', 'already-aabbccdd.js'), 'export const hashed = true;\n');
		await writeFile(path.join(tempDir, 'javascripts', 'already-aabbccdd.js.br'), 'br');
		await writeFile(path.join(tempDir, 'readme.txt'), 'plain text');

		const manifest = await fingerprintAndCompressStaticAssets(tempDir);
		assert.equal(manifest.assets['javascripts/map-layers-demo.test.js'], undefined);
		assert.equal(manifest.assets['javascripts/already-aabbccdd.js'], undefined);
		assert.equal(manifest.assets['readme.txt'], undefined);
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
