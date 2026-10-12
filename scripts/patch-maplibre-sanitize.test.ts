import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, mock, test } from 'node:test';
import {
	PATCHED_REMOVE_ATTRIBUTES,
	VULNERABLE_REMOVE_ATTRIBUTES,
	applyMaplibreSanitizePatch,
	defraMaplibreFrameworkPath,
	patchDefraMaplibreFrameworkFile
} from './patch-maplibre-sanitize.ts';

describe('applyMaplibreSanitizePatch', () => {
	test('rewrites the vulnerable live NamedNodeMap loop to Array.from', () => {
		const source = `prefix;${VULNERABLE_REMOVE_ATTRIBUTES};suffix`;
		const result = applyMaplibreSanitizePatch(source);
		assert.equal(result.changed, true);
		assert.equal(result.alreadyPatched, false);
		assert.equal(result.source, `prefix;${PATCHED_REMOVE_ATTRIBUTES};suffix`);
		assert.equal(result.source.includes(VULNERABLE_REMOVE_ATTRIBUTES), false);
	});

	test('is a no-op when the bundle is already patched', () => {
		const source = `prefix;${PATCHED_REMOVE_ATTRIBUTES};suffix`;
		const result = applyMaplibreSanitizePatch(source);
		assert.equal(result.changed, false);
		assert.equal(result.alreadyPatched, true);
		assert.equal(result.source, source);
	});

	test('throws when neither vulnerable nor patched pattern is present', () => {
		assert.throws(
			() => applyMaplibreSanitizePatch('static removeAttributes(t){/* unexpected shape */}'),
			/expected vulnerable removeAttributes pattern was not found/
		);
	});
});

describe('defraMaplibreFrameworkPath', () => {
	test('resolves the Defra UMD under a given package root', () => {
		assert.match(
			defraMaplibreFrameworkPath('/repo'),
			/\/repo\/node_modules\/@defra\/interactive-map\/providers\/maplibre\/dist\/umd\/im-maplibre-framework\.js$/
		);
	});
});

describe('patchDefraMaplibreFrameworkFile', () => {
	function withBundle(contents: string, fn: (filePath: string) => void) {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maplibre-sanitize-test-'));
		try {
			const filePath = path.join(dir, 'im-maplibre-framework.js');
			fs.writeFileSync(filePath, contents);
			fn(filePath);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	}

	test('rewrites a vulnerable bundle on disk, logging when asked', () => {
		const log = mock.method(console, 'log', () => {});
		try {
			withBundle(`prefix;${VULNERABLE_REMOVE_ATTRIBUTES};suffix`, (filePath) => {
				assert.equal(patchDefraMaplibreFrameworkFile(filePath, { log: true }), true);
				assert.equal(fs.readFileSync(filePath, 'utf8'), `prefix;${PATCHED_REMOVE_ATTRIBUTES};suffix`);
			});
			assert.equal(log.mock.callCount(), 1);
			assert.match(log.mock.calls[0].arguments[0], /Patched MapLibre sanitize/);
		} finally {
			log.mock.restore();
		}
	});

	test('leaves an already-patched bundle alone, logging when asked', () => {
		const log = mock.method(console, 'log', () => {});
		try {
			withBundle(`prefix;${PATCHED_REMOVE_ATTRIBUTES};suffix`, (filePath) => {
				assert.equal(patchDefraMaplibreFrameworkFile(filePath, { log: true }), false);
				assert.equal(fs.readFileSync(filePath, 'utf8'), `prefix;${PATCHED_REMOVE_ATTRIBUTES};suffix`);
			});
			assert.equal(log.mock.callCount(), 1);
			assert.match(log.mock.calls[0].arguments[0], /already patched/);
		} finally {
			log.mock.restore();
		}
	});
});
