import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { copyDefraVendorEntryAssets, DEFRA_VENDOR_ROOTS, writeVendorCompressionSidecars } from './vendor-assets.ts';

describe('vendor-assets', () => {
	/** @type {string | undefined} */
	let tempDir;

	after(async () => {
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	test('copies each vendor bundle entry file under its public /vendor path', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'vendor-assets-'));

		await copyDefraVendorEntryAssets(tempDir);

		for (const [prefix, root] of Object.entries(DEFRA_VENDOR_ROOTS)) {
			const entryFile = prefix.endsWith('/js') ? 'index.js' : 'index.css';
			const copied = await readFile(path.join(tempDir, 'vendor', ...prefix.split('/'), entryFile));
			const source = await readFile(path.join(root, entryFile));
			assert.deepEqual(copied, source, `${prefix}/${entryFile} was not copied from ${root}`);
		}
	});

	test('clears stale fingerprinted entry files from the previous build', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'vendor-assets-'));
		const staleDir = path.join(tempDir, 'vendor', 'interactive-map', 'js');
		await mkdir(staleDir, { recursive: true });
		const staleFile = path.join(staleDir, 'index-deadbeef.js');
		await writeFile(staleFile, 'stale');

		await copyDefraVendorEntryAssets(tempDir);

		await assert.rejects(stat(staleFile), { code: 'ENOENT' });
	});

	test('minifies lazy chunks in place then writes br/gz sidecars', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'vendor-sidecars-'));
		const nested = path.join(tempDir, 'chunks');
		await mkdir(nested, { recursive: true });
		const chunk = path.join(nested, '5300.js');
		// string payload stays large after minify (numeric literals can collapse)
		const chunkBody = `globalThis.chunk = "${'x'.repeat(4096)}";\n`;
		await writeFile(chunk, chunkBody);
		await writeFile(path.join(nested, 'tiny.js'), 'x=1');
		await writeFile(path.join(nested, 'logo.png'), Buffer.from([137, 80, 78, 71]));
		await writeFile(path.join(nested, 'index.js'), `globalThis.entry = "${'x'.repeat(4096)}";\n`);

		await writeVendorCompressionSidecars({ 'test/js': tempDir });

		const onDisk = await readFile(chunk, 'utf8');
		assert.ok(onDisk.length < chunkBody.length, 'lazy chunk should be minified in place');
		assert.deepEqual(brotliDecompressSync(await readFile(`${chunk}.br`)).toString(), onDisk);
		assert.deepEqual(gunzipSync(await readFile(`${chunk}.gz`)).toString(), onDisk);
		// entry index.js is fingerprinted elsewhere — leave bytes alone here
		assert.equal(await readFile(path.join(nested, 'index.js'), 'utf8'), `globalThis.entry = "${'x'.repeat(4096)}";\n`);
		// below the size floor, and non-compressible formats, get nothing
		await assert.rejects(stat(`${path.join(nested, 'tiny.js')}.br`), { code: 'ENOENT' });
		await assert.rejects(stat(`${path.join(nested, 'logo.png')}.gz`), { code: 'ENOENT' });
	});

	test('reuses fresh sidecars and recompresses only files that changed', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'vendor-sidecars-'));
		const chunk = path.join(tempDir, '5300.js');
		const unchanged = path.join(tempDir, 'unchanged.js');
		await writeFile(chunk, `globalThis.chunk = "${'x'.repeat(4096)}";\n`);
		await writeFile(unchanged, `globalThis.same = "${'y'.repeat(4096)}";\n`);

		await writeVendorCompressionSidecars({ 'test/js': tempDir });
		const unchangedBrMtime = (await stat(`${unchanged}.br`)).mtimeMs;

		// the shape an upgraded package leaves: same filename, new bytes + mtime;
		// the pause keeps the new mtime clearly ahead of the first sidecars
		await new Promise((resolve) => setTimeout(resolve, 20));
		await writeFile(chunk, `globalThis.chunk = "${'z'.repeat(4096)}";\n`);
		await writeVendorCompressionSidecars({ 'test/js': tempDir });

		const chunkOnDisk = await readFile(chunk, 'utf8');
		assert.equal(gunzipSync(await readFile(`${chunk}.gz`)).toString(), chunkOnDisk);
		assert.equal((await stat(`${unchanged}.br`)).mtimeMs, unchangedBrMtime);

		// and a third run changes nothing at all
		const chunkBrMtime = (await stat(`${chunk}.br`)).mtimeMs;
		await new Promise((resolve) => setTimeout(resolve, 20));
		await writeVendorCompressionSidecars({ 'test/js': tempDir });
		assert.equal((await stat(`${chunk}.br`)).mtimeMs, chunkBrMtime);
	});
});
