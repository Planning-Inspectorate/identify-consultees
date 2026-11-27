import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import {
	MINIFY_PIPELINE_ID,
	emitFingerprintedStyleCss,
	hashUnminifiedForMinify,
	minifyAssetContent,
	minifyCss,
	minifyJs,
	minifyVendorChunkInPlace,
	shouldMinifyAsset
} from './minify-assets.ts';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(require.resolve('govuk-frontend'), '../../../../..');

describe('minify-assets', () => {
	/** @type {string | undefined} */
	let tempDir;

	after(async () => {
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	test('shouldMinifyAsset covers first-party and vendor entries, skips .min', () => {
		assert.equal(shouldMinifyAsset('javascripts/consultees-map.js'), true);
		assert.equal(shouldMinifyAsset('javascripts/plugin.mjs'), true);
		assert.equal(shouldMinifyAsset('vendor/interactive-map/js/index.js'), true);
		assert.equal(shouldMinifyAsset('vendor/interactive-map/css/index.css'), true);
		assert.equal(shouldMinifyAsset('assets/js/govuk-frontend.min.js'), false);
		assert.equal(shouldMinifyAsset('assets/css/accessible-autocomplete.min.css'), false);
		assert.equal(shouldMinifyAsset('vendor/interactive-map/js/5300.js'), false);
	});

	test('hashUnminifiedForMinify is stable for content and includes the pipeline id', () => {
		const a = hashUnminifiedForMinify('export const x = 1;\n');
		const b = hashUnminifiedForMinify('export const x = 1;\n');
		assert.equal(a, b);
		assert.match(a, /^[0-9a-f]{8}$/);
		assert.notEqual(hashUnminifiedForMinify('export const x = 2;\n'), a);
		assert.match(MINIFY_PIPELINE_ID, /^esbuild@/);
	});

	test('minifyJs preserves ESM exports for first-party modules', () => {
		const source = "export const greeting = 'hello';\nexport function greet() { return greeting; }\n";
		const minified = minifyJs(source, 'javascripts/app.js');
		assert.ok(minified.includes('export'));
		assert.ok(minified.length < source.length);
	});

	test('minifyCss shrinks expanded rules', () => {
		const source = 'body {\n  color: red;\n  margin: 0;\n}\n';
		const minified = minifyCss(source, 'style.css');
		assert.ok(minified.length < source.length);
		assert.ok(minified.includes('color:red') || minified.includes('color: red'));
	});

	test('minifyAssetContent routes by extension', () => {
		assert.ok(minifyAssetContent('export const a = 1;\n', 'javascripts/a.js').includes('export'));
		assert.ok(minifyAssetContent('a { color: #ff0000; }\n', 'vendor/x/css/index.css').length > 0);
		assert.equal(minifyAssetContent('plain', 'readme.txt'), 'plain');
	});

	test('minifyVendorChunkInPlace returns null when minify does not shrink', () => {
		assert.equal(minifyVendorChunkInPlace('x=1', 'chunk.js'), null);
		assert.equal(minifyVendorChunkInPlace('a{}', 'already.min.css'), null);
		assert.equal(minifyVendorChunkInPlace('nope', 'chunk.txt'), null);
		assert.equal(minifyVendorChunkInPlace('nope', 'chunk.png'), null);
		assert.equal(
			minifyVendorChunkInPlace('anything', 'chunk.js', {
				css: () => '',
				js: () => ''
			}),
			null
		);
	});

	test('minifyVendorChunkInPlace returns minified CSS when it shrinks', () => {
		const source = 'body {\n  color: red;\n  margin: 0;\n}\n'.repeat(20);
		const minified = minifyVendorChunkInPlace(source, 'chunk.css');
		assert.ok(minified);
		assert.ok(minified.length < source.length);
	});

	test('minifyVendorChunkInPlace swallows minify failures', () => {
		assert.equal(
			minifyVendorChunkInPlace('export const a = 1;\n', 'chunk.js', {
				css: () => {
					throw new Error('forced');
				},
				js: () => {
					throw new Error('forced');
				}
			}),
			null
		);
		assert.equal(
			minifyVendorChunkInPlace('body { color: red; }\n'.repeat(10), 'chunk.css', {
				css: () => {
					throw new Error('forced');
				},
				js: () => {
					throw new Error('forced');
				}
			}),
			null
		);
	});

	test('minifyJs without ESM format for vendor paths', () => {
		const source = 'var x = 1;\nvar y = 2;\n';
		const minified = minifyJs(source, 'vendor/chunk/5300.js');
		assert.ok(minified.length < source.length);
	});

	test('minifyAssetContent handles .mjs', () => {
		const minified = minifyAssetContent('export const a = 1;\n', 'javascripts/a.mjs');
		assert.ok(minified.includes('export'));
	});

	test('emitFingerprintedStyleCss writes hashed minified style and removes prior style files', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'minify-style-'));
		const srcDir = path.join(tempDir, 'src');
		await mkdir(path.join(srcDir, 'app', 'sass'), { recursive: true });
		await writeFile(
			path.join(srcDir, 'app', 'sass', 'style.scss'),
			'$c: #112233;\nbody {\n  color: $c;\n  margin: 0;\n}\n'
		);
		await writeFile(path.join(tempDir, 'style-aabbccdd.css'), 'stale');
		await writeFile(path.join(tempDir, 'style-aabbccdd.css.br'), 'stale-br');

		const filename = await emitFingerprintedStyleCss({
			staticDir: tempDir,
			srcDir,
			repoRoot
		});
		assert.match(filename, /^style-[0-9a-f]{8}\.css$/);
		const css = await readFile(path.join(tempDir, filename), 'utf8');
		assert.ok(css.includes('112233') || css.includes('#123'));
		await assert.rejects(readFile(path.join(tempDir, 'style-aabbccdd.css')), { code: 'ENOENT' });
		await assert.rejects(readFile(path.join(tempDir, 'style-aabbccdd.css.br')), { code: 'ENOENT' });
	});
});
