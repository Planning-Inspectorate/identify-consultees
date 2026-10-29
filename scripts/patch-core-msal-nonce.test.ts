import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, mock, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	PATCHED_ACQUIRE_TOKEN_BY_CODE,
	UNPATCHED_ACQUIRE_TOKEN_BY_CODE,
	applyCoreMsalNoncePatch,
	coreAuthServicePath,
	patchCoreAuthServiceFile
} from './patch-core-msal-nonce.ts';

describe('applyCoreMsalNoncePatch', () => {
	test('moves the session nonce onto the acquireTokenByCode request', () => {
		const source = `prefix;${UNPATCHED_ACQUIRE_TOKEN_BY_CODE};suffix`;
		const result = applyCoreMsalNoncePatch(source);
		assert.equal(result.changed, true);
		assert.equal(result.alreadyPatched, false);
		assert.equal(result.source, `prefix;${PATCHED_ACQUIRE_TOKEN_BY_CODE};suffix`);
		assert.equal(result.source.includes(UNPATCHED_ACQUIRE_TOKEN_BY_CODE), false);
	});

	test('is a no-op when the file is already patched', () => {
		const source = `prefix;${PATCHED_ACQUIRE_TOKEN_BY_CODE};suffix`;
		const result = applyCoreMsalNoncePatch(source);
		assert.equal(result.changed, false);
		assert.equal(result.alreadyPatched, true);
		assert.equal(result.source, source);
	});

	test('throws when neither unpatched nor patched pattern is present', () => {
		assert.throws(
			() => applyCoreMsalNoncePatch('msalClient.acquireTokenByCode({ /* unexpected shape */ });'),
			/expected unpatched acquireTokenByCode pattern was not found/
		);
	});
});

describe('coreAuthServicePath', () => {
	test('resolves the installed auth-service.js under a given package root', () => {
		assert.match(
			coreAuthServicePath(process.cwd()),
			/node_modules\/@planning-inspectorate\/core\/dist\/auth\/auth-service\.js$/
		);
	});
});

describe('patchCoreAuthServiceFile', () => {
	function withAuthService(contents: string, fn: (filePath: string) => void) {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-msal-nonce-test-'));
		try {
			const filePath = path.join(dir, 'auth-service.js');
			fs.writeFileSync(filePath, contents);
			fn(filePath);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	}

	test('rewrites an unpatched file on disk, logging when asked', () => {
		const log = mock.method(console, 'log', () => {});
		try {
			withAuthService(`prefix;${UNPATCHED_ACQUIRE_TOKEN_BY_CODE};suffix`, (filePath) => {
				assert.equal(patchCoreAuthServiceFile(filePath, { log: true }), true);
				assert.equal(fs.readFileSync(filePath, 'utf8'), `prefix;${PATCHED_ACQUIRE_TOKEN_BY_CODE};suffix`);
			});
			assert.equal(log.mock.callCount(), 1);
			assert.match(log.mock.calls[0].arguments[0] as string, /Patched core acquireTokenByCode nonce/);
		} finally {
			log.mock.restore();
		}
	});

	test('leaves an already-patched file alone, logging when asked', () => {
		const log = mock.method(console, 'log', () => {});
		try {
			withAuthService(`prefix;${PATCHED_ACQUIRE_TOKEN_BY_CODE};suffix`, (filePath) => {
				assert.equal(patchCoreAuthServiceFile(filePath, { log: true }), false);
				assert.equal(fs.readFileSync(filePath, 'utf8'), `prefix;${PATCHED_ACQUIRE_TOKEN_BY_CODE};suffix`);
			});
			assert.equal(log.mock.callCount(), 1);
			assert.match(log.mock.calls[0].arguments[0] as string, /already patched/);
		} finally {
			log.mock.restore();
		}
	});

	test('patches silently when no options are given', () => {
		withAuthService(`prefix;${UNPATCHED_ACQUIRE_TOKEN_BY_CODE};suffix`, (filePath) => {
			assert.equal(patchCoreAuthServiceFile(filePath), true);
			assert.equal(fs.readFileSync(filePath, 'utf8'), `prefix;${PATCHED_ACQUIRE_TOKEN_BY_CODE};suffix`);
		});
	});
});

// the isMain block only runs when the file is invoked as a script, so these spawn the real CLI in
// a child process - child coverage still counts towards this file's numbers
const scriptPath = fileURLToPath(new URL('./patch-core-msal-nonce.ts', import.meta.url));

function withPackageRoot(files: Record<string, string>, fn: (dir: string) => void) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-msal-nonce-main-'));
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

const corePackage = {
	'node_modules/@planning-inspectorate/core/package.json': JSON.stringify({
		name: '@planning-inspectorate/core',
		type: 'module',
		main: 'dist/index.js'
	}),
	'node_modules/@planning-inspectorate/core/dist/index.js': 'export {};\n',
	'node_modules/@planning-inspectorate/core/dist/auth/auth-service.js': `prefix;${UNPATCHED_ACQUIRE_TOKEN_BY_CODE};suffix`
};

describe('running as a postinstall script', () => {
	test('skips with a message when core is not installed under cwd', () => {
		withPackageRoot({}, (dir) => {
			const stdout = execFileSync(process.execPath, ['--experimental-strip-types', scriptPath], {
				cwd: dir,
				encoding: 'utf8'
			});
			assert.match(stdout, /not installed here, skipping/);
		});
	});

	test('patches the installed auth-service.js found under cwd', () => {
		withPackageRoot(corePackage, (dir) => {
			const stdout = execFileSync(process.execPath, ['--experimental-strip-types', scriptPath], {
				cwd: dir,
				encoding: 'utf8'
			});
			assert.match(stdout, /Patched core acquireTokenByCode nonce/);
			assert.equal(
				fs.readFileSync(path.join(dir, 'node_modules/@planning-inspectorate/core/dist/auth/auth-service.js'), 'utf8'),
				`prefix;${PATCHED_ACQUIRE_TOKEN_BY_CODE};suffix`
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
