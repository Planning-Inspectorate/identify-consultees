import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, mock, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	applyCoreMsalNoncePatch,
	coreAuthServicePath,
	patchCoreAuthServiceFile,
	PATCHED_TOKEN_REQUEST,
	VULNERABLE_TOKEN_REQUEST
} from './patch-core-msal-nonce.ts';

describe('applyCoreMsalNoncePatch', () => {
	test('adds nonce to the acquireTokenByCode request object', () => {
		const source = `prefix;\n        return await msalClient.${VULNERABLE_TOKEN_REQUEST};\nsuffix`;
		const result = applyCoreMsalNoncePatch(source);
		assert.equal(result.changed, true);
		assert.equal(result.alreadyPatched, false);
		assert.equal(result.source, `prefix;\n        return await msalClient.${PATCHED_TOKEN_REQUEST};\nsuffix`);
		assert.equal(result.source.includes(VULNERABLE_TOKEN_REQUEST), false);
		assert.equal(result.source.includes(PATCHED_TOKEN_REQUEST), true);
	});

	test('leaves the authCodePayload second argument in place', () => {
		const result = applyCoreMsalNoncePatch(VULNERABLE_TOKEN_REQUEST);
		assert.equal(result.source.endsWith('}, authCodePayload)'), true);
	});

	test('is a no-op when the bundle is already patched', () => {
		const source = `prefix;${PATCHED_TOKEN_REQUEST};suffix`;
		const result = applyCoreMsalNoncePatch(source);
		assert.equal(result.changed, false);
		assert.equal(result.alreadyPatched, true);
		assert.equal(result.source, source);
	});

	test('throws when neither vulnerable nor patched pattern is present', () => {
		assert.throws(
			() => applyCoreMsalNoncePatch('acquireTokenByCode({ code }, authCodePayload)'),
			/expected acquireTokenByCode request without nonce was not found/
		);
	});
});

describe('coreAuthServicePath', () => {
	test('resolves the core auth service bundle under a given package root', () => {
		const filePath = coreAuthServicePath('/repo');
		assert.match(filePath, /\/repo\/node_modules\/@planning-inspectorate\/core\/dist\/auth\/auth-service\.js$/);
	});
});

describe('patchCoreAuthServiceFile', () => {
	function withBundle(contents: string, fn: (filePath: string) => void) {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-msal-nonce-test-'));
		try {
			const filePath = path.join(dir, 'auth-service.js');
			fs.writeFileSync(filePath, contents);
			fn(filePath);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	}

	test('rewrites a vulnerable bundle on disk, logging when asked', () => {
		const log = mock.method(console, 'log', () => {});
		try {
			withBundle(`prefix;${VULNERABLE_TOKEN_REQUEST};suffix`, (filePath) => {
				assert.equal(patchCoreAuthServiceFile(filePath, { log: true }), true);
				assert.equal(fs.readFileSync(filePath, 'utf8'), `prefix;${PATCHED_TOKEN_REQUEST};suffix`);
			});
			assert.equal(log.mock.callCount(), 1);
			assert.match(log.mock.calls[0].arguments[0], /send nonce on the request/);
		} finally {
			log.mock.restore();
		}
	});

	test('leaves an already-patched bundle alone, logging when asked', () => {
		const log = mock.method(console, 'log', () => {});
		try {
			withBundle(`prefix;${PATCHED_TOKEN_REQUEST};suffix`, (filePath) => {
				assert.equal(patchCoreAuthServiceFile(filePath, { log: true }), false);
				assert.equal(fs.readFileSync(filePath, 'utf8'), `prefix;${PATCHED_TOKEN_REQUEST};suffix`);
			});
			assert.equal(log.mock.callCount(), 1);
			assert.match(log.mock.calls[0].arguments[0], /already applied/);
		} finally {
			log.mock.restore();
		}
	});

	test('patches silently when no options are given', () => {
		withBundle(`prefix;${VULNERABLE_TOKEN_REQUEST};suffix`, (filePath) => {
			assert.equal(patchCoreAuthServiceFile(filePath), true);
			assert.equal(fs.readFileSync(filePath, 'utf8'), `prefix;${PATCHED_TOKEN_REQUEST};suffix`);
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

function runScript(cwd: string): string {
	return execFileSync(process.execPath, ['--experimental-strip-types', scriptPath], { cwd, encoding: 'utf8' });
}

describe('running as a postinstall script', () => {
	test('skips with a message when @planning-inspectorate/core is not installed under cwd', () => {
		withPackageRoot({}, (dir) => {
			const stdout = runScript(dir);
			assert.match(stdout, /not installed here, skipping/);
		});
	});

	test('patches the installed core auth service bundle under cwd', () => {
		const bundle = 'node_modules/@planning-inspectorate/core/dist/auth/auth-service.js';
		withPackageRoot({ [bundle]: `prefix;${VULNERABLE_TOKEN_REQUEST};suffix` }, (dir) => {
			const stdout = runScript(dir);
			assert.match(stdout, /send nonce on the request/);
			assert.equal(fs.readFileSync(path.join(dir, bundle), 'utf8'), `prefix;${PATCHED_TOKEN_REQUEST};suffix`);
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
