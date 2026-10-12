import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, mock, test } from 'node:test';
import {
	applyImAriaControlsPatch,
	defraImCorePaths,
	patchDefraImCoreFile,
	PATCHED_ARIA_CONTROLS,
	VULNERABLE_ARIA_CONTROLS
} from './patch-im-aria-controls.ts';

const VULNERABLE_SNIPPET = '"aria-controls":"".concat(e,"-features")';
const PATCHED_SNIPPET = '"aria-controls":"".concat(e,"-spatial-list")';

describe('applyImAriaControlsPatch', () => {
	test('rewrites the dangling -features idref to -spatial-list', () => {
		const source = `prefix;${VULNERABLE_SNIPPET};suffix`;
		const result = applyImAriaControlsPatch(source);
		assert.equal(result.changed, true);
		assert.equal(result.alreadyPatched, false);
		assert.equal(result.source, `prefix;${PATCHED_SNIPPET};suffix`);
		assert.equal(VULNERABLE_ARIA_CONTROLS.test(result.source), false);
		assert.equal(PATCHED_ARIA_CONTROLS.test(result.source), true);
	});

	test('preserves the minified variable name used by the bundle', () => {
		const source = '"aria-controls":"".concat(t,"-features")';
		const result = applyImAriaControlsPatch(source);
		assert.equal(result.source, '"aria-controls":"".concat(t,"-spatial-list")');
	});

	test('does not touch other -features references', () => {
		const source = `id:"".concat(e,"-features");${VULNERABLE_SNIPPET}`;
		const result = applyImAriaControlsPatch(source);
		assert.equal(result.source, `id:"".concat(e,"-features");${PATCHED_SNIPPET}`);
	});

	test('is a no-op when the bundle is already patched', () => {
		const source = `prefix;${PATCHED_SNIPPET};suffix`;
		const result = applyImAriaControlsPatch(source);
		assert.equal(result.changed, false);
		assert.equal(result.alreadyPatched, true);
		assert.equal(result.source, source);
	});

	test('throws when neither vulnerable nor patched pattern is present', () => {
		assert.throws(
			() => applyImAriaControlsPatch('"aria-controls":"".concat(e,"-other")'),
			/expected dangling "-features" idref was not found/
		);
	});
});

describe('defraImCorePaths', () => {
	test('resolves the UMD and ESM Defra bundles under a given package root', () => {
		const paths = defraImCorePaths('/repo');
		assert.equal(paths.length, 2);
		assert.match(paths[0], /\/repo\/node_modules\/@defra\/interactive-map\/dist\/umd\/im-core\.js$/);
		assert.match(paths[1], /\/repo\/node_modules\/@defra\/interactive-map\/dist\/esm\/im-core\.js$/);
	});
});

describe('patchDefraImCoreFile', () => {
	function withBundle(contents: string, fn: (filePath: string) => void) {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-aria-controls-test-'));
		try {
			const filePath = path.join(dir, 'im-core.js');
			fs.writeFileSync(filePath, contents);
			fn(filePath);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	}

	test('rewrites a vulnerable bundle on disk, logging when asked', () => {
		const log = mock.method(console, 'log', () => {});
		try {
			withBundle(`prefix;${VULNERABLE_SNIPPET};suffix`, (filePath) => {
				assert.equal(patchDefraImCoreFile(filePath, { log: true }), true);
				assert.equal(fs.readFileSync(filePath, 'utf8'), `prefix;${PATCHED_SNIPPET};suffix`);
			});
			assert.equal(log.mock.callCount(), 1);
			assert.match(log.mock.calls[0].arguments[0], /Patched viewport aria-controls/);
		} finally {
			log.mock.restore();
		}
	});

	test('leaves an already-patched bundle alone, logging when asked', () => {
		const log = mock.method(console, 'log', () => {});
		try {
			withBundle(`prefix;${PATCHED_SNIPPET};suffix`, (filePath) => {
				assert.equal(patchDefraImCoreFile(filePath, { log: true }), false);
				assert.equal(fs.readFileSync(filePath, 'utf8'), `prefix;${PATCHED_SNIPPET};suffix`);
			});
			assert.equal(log.mock.callCount(), 1);
			assert.match(log.mock.calls[0].arguments[0], /already patched/);
		} finally {
			log.mock.restore();
		}
	});
});
