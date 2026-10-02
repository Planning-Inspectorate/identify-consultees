import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { copyDefraVendorEntryAssets, DEFRA_VENDOR_ROOTS } from './vendor-assets.ts';

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
});
