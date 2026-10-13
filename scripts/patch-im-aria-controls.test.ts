import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, mock, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

	test('patches silently when no options are given', () => {
		withBundle(`prefix;${VULNERABLE_SNIPPET};suffix`, (filePath) => {
			assert.equal(patchDefraImCoreFile(filePath), true);
			assert.equal(fs.readFileSync(filePath, 'utf8'), `prefix;${PATCHED_SNIPPET};suffix`);
		});
	});
});

// the isMain block only runs when the file is invoked as a script, so these spawn the real CLI in
// a child process - child coverage still counts towards this file's numbers
const scriptPath = fileURLToPath(new URL('./patch-im-aria-controls.ts', import.meta.url));

function withPackageRoot(files: Record<string, string>, fn: (dir: string) => void) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-aria-controls-main-'));
	try {
		for (const [relativePath, contents] of Object.entries(files)) {
			const target = path.join(dir, relativePath);
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.writeFileSync(target, contents);
		}
		fn(dir);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

function runScript(cwd: string): string {
	return execFileSync(process.execPath, ['--experimental-strip-types', scriptPath], { cwd, encoding: 'utf8' });
}

describe('running as a postinstall script', () => {
	test('skips with a message when the Defra bundle is not installed under cwd', () => {
		withPackageRoot({}, (dir) => {
			const stdout = runScript(dir);
			assert.match(stdout, /not installed here, skipping/);
		});
	});

	test('patches every installed Defra bundle found under cwd', () => {
		// only the UMD bundle is present - workspace-scoped installs only have what got installed,
		// so a missing sibling build is normal and is filtered out rather than failing
		const umdBundle = 'node_modules/@defra/interactive-map/dist/umd/im-core.js';
		withPackageRoot({ [umdBundle]: `prefix;${VULNERABLE_SNIPPET};suffix` }, (dir) => {
			const stdout = runScript(dir);
			assert.match(stdout, /Patched viewport aria-controls/);
			assert.equal(fs.readFileSync(path.join(dir, umdBundle), 'utf8'), `prefix;${PATCHED_SNIPPET};suffix`);
		});
	});

	test('does nothing when imported rather than run as a script', () => {
		// an eval-mode import has no argv[1] at all, so the isMain guard stays false
		const stdout = execFileSync(
			process.execPath,
			['--input-type=module', '--eval', `await import(${JSON.stringify(pathToFileURL(scriptPath).href)})`],
			{ encoding: 'utf8' }
		);
		assert.equal(stdout, '');
	});
});
