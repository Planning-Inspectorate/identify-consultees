import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, mock, test } from 'node:test';
import { addLocalsConfiguration } from './config-middleware.ts';
import { ASSET_MANIFEST_FILENAME, LOCALS_ASSET_BINDINGS } from './fingerprint-assets.ts';

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

	test('entries missing from the manifest keep their logical fallbacks', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'config-partial-'));
		const manifest = sentinelManifest();
		delete manifest.assets['javascripts/consultees-map.js'];
		await writeFile(path.join(tempDir, ASSET_MANIFEST_FILENAME), JSON.stringify(manifest));

		const config = localsConfig(tempDir);
		assert.match(String(config.vendorDrawPluginJs), /^hashed-\d+$/);
		assert.equal(config.consulteesMapJs, 'javascripts/consultees-map.js');
	});

	test('serves logical fallbacks when no manifest can be read', () => {
		const config = localsConfig();
		assert.equal(config.styleFile, 'style.css');
		assert.equal(config.consulteesMapJs, 'javascripts/consultees-map.js');
		assert.equal(config.headerTitle, 'Identify consultees');
		assert.equal(
			config.metaDescription,
			'Identify organisations that must be consulted about a national infrastructure project.'
		);
		assert.ok(Array.isArray(config.footerLinks));
	});

	test('a missing or malformed manifest under staticDir also falls back', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'config-nomanifest-'));
		assert.equal(localsConfig(tempDir).consulteesMapJs, 'javascripts/consultees-map.js');

		await writeFile(path.join(tempDir, ASSET_MANIFEST_FILENAME), 'not json');
		assert.equal(localsConfig(tempDir).consulteesMapJs, 'javascripts/consultees-map.js');
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

	test('every LOCALS_ASSET_BINDING has a logical fallback property', () => {
		const config = localsConfig();
		for (const { logical, property } of LOCALS_ASSET_BINDINGS) {
			assert.equal(config[property], logical, `${property} fallback should be the logical path`);
		}
	});
});
