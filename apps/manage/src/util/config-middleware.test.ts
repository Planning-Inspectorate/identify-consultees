import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { addLocalsConfiguration } from './config-middleware.ts';
import {
	applyAssetManifestToLocalsFile,
	ASSET_MANIFEST_FILENAME,
	LOCALS_ASSET_BINDINGS
} from './fingerprint-assets.ts';

const localsFile = fileURLToPath(new URL('./config-middleware.ts', import.meta.url));

/** Run the middleware once and return res.locals.config. */
function localsConfig(staticDir?: string): Record<string, unknown> {
	const res = { locals: {} as { config?: Record<string, unknown> } };
	const next = mock.fn();
	addLocalsConfiguration(staticDir)({} as never, res as never, next);
	assert.equal(next.mock.calls.length, 1);
	assert.ok(res.locals.config);
	return res.locals.config;
}

/** A manifest whose entries all point at recognisable sentinel names. */
function sentinelManifest(entries: Record<string, string> = {}) {
	return {
		assets: Object.fromEntries(
			LOCALS_ASSET_BINDINGS.map(({ logical }, i) => [logical, entries[logical] ?? `hashed-${i}`])
		)
	};
}

describe('config-middleware', () => {
	let tempDir: string | undefined;

	after(async () => {
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	test('resolves every bound asset path from the build manifest', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'config-manifest-'));
		await writeFile(path.join(tempDir, ASSET_MANIFEST_FILENAME), JSON.stringify(sentinelManifest()));

		const config = localsConfig(tempDir);
		for (const { property } of LOCALS_ASSET_BINDINGS) {
			assert.match(String(config[property]), /^hashed-\d+$/, `${property} should come from the manifest`);
		}
	});

	test('entries missing from the manifest keep their fallback literals', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'config-partial-'));
		const manifest = sentinelManifest();
		delete manifest.assets['javascripts/consultees-map.js'];
		await writeFile(path.join(tempDir, ASSET_MANIFEST_FILENAME), JSON.stringify(manifest));

		const config = localsConfig(tempDir);
		assert.match(String(config.vendorDrawPluginJs), /^hashed-\d+$/);
		assert.match(String(config.consulteesMapJs), /^javascripts\/consultees-map-[0-9a-f]{8}\.js$/);
	});

	test('serves the checked-in fallbacks when no manifest can be read', () => {
		const config = localsConfig();
		assert.match(String(config.styleFile), /^style-[0-9a-f]{8}\.css$/);
		assert.match(String(config.consulteesMapJs), /^javascripts\/consultees-map-[0-9a-f]{8}\.js$/);
		assert.equal(config.headerTitle, 'Identify consultees');
		assert.ok(Array.isArray(config.footerLinks));
	});

	test('a missing or malformed manifest under staticDir also falls back', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'config-nomanifest-'));
		const fallback = /^javascripts\/consultees-map-[0-9a-f]{8}\.js$/;
		assert.match(String(localsConfig(tempDir).consulteesMapJs), fallback);

		await writeFile(path.join(tempDir, ASSET_MANIFEST_FILENAME), 'not json');
		assert.match(String(localsConfig(tempDir).consulteesMapJs), fallback);
	});

	test('logs an error in production when the manifest cannot be read', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'config-prodwarn-'));
		const error = mock.method(console, 'error', () => {});
		const nodeEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = 'production';
		try {
			localsConfig(tempDir);
		} finally {
			if (nodeEnv === undefined) {
				delete process.env.NODE_ENV;
			} else {
				process.env.NODE_ENV = nodeEnv;
			}
		}
		assert.equal(error.mock.calls.length, 1);
		assert.match(String(error.mock.calls[0].arguments[0]), /no asset manifest/);
		error.mock.restore();
	});

	test('does not log outside production when the manifest cannot be read', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'config-nodevwarn-'));
		const error = mock.method(console, 'error', () => {});
		const nodeEnv = process.env.NODE_ENV;
		delete process.env.NODE_ENV;
		try {
			localsConfig(tempDir);
		} finally {
			if (nodeEnv !== undefined) {
				process.env.NODE_ENV = nodeEnv;
			}
			error.mock.restore();
		}
		assert.equal(error.mock.calls.length, 0);
	});

	test('the manifest is read once at start - later disk changes do not leak into pages', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'config-once-'));
		const manifestPath = path.join(tempDir, ASSET_MANIFEST_FILENAME);
		await writeFile(manifestPath, JSON.stringify(sentinelManifest()));

		const res = { locals: {} as { config?: Record<string, unknown> } };
		const handler = addLocalsConfiguration(tempDir);
		await rm(manifestPath);
		handler({} as never, res as never, () => {});
		assert.match(String(res.locals.config?.consulteesMapJs), /^hashed-\d+$/);
	});

	test('every binding has a literal the build rewrite can find in the real file', async () => {
		const source = await readFile(localsFile, 'utf8');
		for (const { property } of LOCALS_ASSET_BINDINGS) {
			assert.match(
				source,
				new RegExp(`${property}\\s*:\\s*'[^']*'`),
				`${property} needs a 'value' literal for the build to rewrite`
			);
		}
	});

	test('the build rewrite updates every property in the real file', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'config-rewrite-'));
		const copy = path.join(tempDir, 'config-middleware.ts');
		await mkdir(tempDir, { recursive: true });
		await writeFile(copy, await readFile(localsFile, 'utf8'));

		await applyAssetManifestToLocalsFile(copy, sentinelManifest());
		const rewritten = await readFile(copy, 'utf8');
		for (const { property } of LOCALS_ASSET_BINDINGS) {
			assert.match(rewritten, new RegExp(`${property}\\s*:\\s*'hashed-\\d+'`), `${property} was not rewritten`);
		}
	});
});
