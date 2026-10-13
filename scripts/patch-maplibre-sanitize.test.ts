import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, mock, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

	test('patches silently when no options are given', () => {
		withBundle(`prefix;${VULNERABLE_REMOVE_ATTRIBUTES};suffix`, (filePath) => {
			assert.equal(patchDefraMaplibreFrameworkFile(filePath), true);
			assert.equal(fs.readFileSync(filePath, 'utf8'), `prefix;${PATCHED_REMOVE_ATTRIBUTES};suffix`);
		});
	});
});

// the isMain block only runs when the file is invoked as a script, so these spawn the real CLI in
// a child process - child coverage still counts towards this file's numbers
const scriptPath = fileURLToPath(new URL('./patch-maplibre-sanitize.ts', import.meta.url));

function withPackageRoot(files: Record<string, string>, fn: (dir: string) => void) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maplibre-sanitize-main-'));
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

const frameworkBundle = 'node_modules/@defra/interactive-map/providers/maplibre/dist/umd/im-maplibre-framework.js';

describe('running as a postinstall script', () => {
	test('skips with a message when the Defra bundle is not installed under cwd', () => {
		withPackageRoot({}, (dir) => {
			const stdout = execFileSync(process.execPath, ['--experimental-strip-types', scriptPath], {
				cwd: dir,
				encoding: 'utf8'
			});
			assert.match(stdout, /not installed here, skipping/);
		});
	});

	test('patches the installed Defra MapLibre bundle found under cwd', () => {
		withPackageRoot({ [frameworkBundle]: `prefix;${VULNERABLE_REMOVE_ATTRIBUTES};suffix` }, (dir) => {
			const stdout = execFileSync(process.execPath, ['--experimental-strip-types', scriptPath], {
				cwd: dir,
				encoding: 'utf8'
			});
			assert.match(stdout, /Patched MapLibre sanitize/);
			assert.equal(
				fs.readFileSync(path.join(dir, frameworkBundle), 'utf8'),
				`prefix;${PATCHED_REMOVE_ATTRIBUTES};suffix`
			);
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
