import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	collectToolchainErrors,
	compareVersions,
	errorMessage,
	npmVersion,
	satisfies,
	versionParts
} from './check-toolchain.ts';

describe('versionParts', () => {
	test('splits a semver string, tolerating a leading v', () => {
		assert.deepEqual(versionParts('v24.22.1'), [24, 22, 1]);
		assert.deepEqual(versionParts('24'), [24]);
	});
});

describe('compareVersions', () => {
	test('orders by major, minor then patch, treating missing parts as 0', () => {
		assert.equal(compareVersions([24, 22, 1], [24, 22, 1]), 0);
		assert.ok(compareVersions([25], [24]) > 0);
		assert.ok(compareVersions([24], [25]) < 0);
		assert.ok(compareVersions([24, 1], [24, 0, 9]) > 0);
		assert.ok(compareVersions([24, 0], [24, 0, 9]) < 0);
	});
});

describe('satisfies', () => {
	test('caret ranges need the same major at or above the floor', () => {
		assert.equal(satisfies('24.22.1', '^24.22.1'), true);
		assert.equal(satisfies('24.30.0', '^24.22.1'), true);
		assert.equal(satisfies('24.22.0', '^24.22.1'), false);
		assert.equal(satisfies('25.0.0', '^24.22.1'), false);
		assert.equal(satisfies('v24.30.0', '^24.22.1'), true);
	});

	test('>= ranges accept any version at or above the floor', () => {
		assert.equal(satisfies('11.19.0', '>=11'), true);
		assert.equal(satisfies('12.0.0', '>=11'), true);
		assert.equal(satisfies('10.9.9', '>=11'), false);
		assert.equal(satisfies('11.2.0', '>=11.2.0'), true);
		assert.equal(satisfies('11.1.9', '>=11.2.0'), false);
	});

	test('a bare major, or one with an x/* minor, matches the whole major line', () => {
		assert.equal(satisfies('24.22.1', '24'), true);
		assert.equal(satisfies('24.0.0', '24.x'), true);
		assert.equal(satisfies('24.0.0', '24.*'), true);
		assert.equal(satisfies('25.0.0', '24.x'), false);
	});

	test('a bare major.minor matches that line exactly', () => {
		assert.equal(satisfies('24.22.9', '24.22'), true);
		assert.equal(satisfies('24.23.0', '24.22'), false);
	});

	test('a full version with no operator is an exact match', () => {
		assert.equal(satisfies('24.22.1', '24.22.1'), true);
		assert.equal(satisfies('24.22.2', '24.22.1'), false);
		assert.equal(satisfies('24.0.0', '24.x.0'), true);
	});

	test('anything else fails closed rather than silently passing', () => {
		assert.equal(satisfies('24.22.1', 'latest'), false);
		assert.equal(satisfies('24.22.1', ''), false);
		assert.equal(satisfies('24.22.1', '24 || 25'), false);
		assert.equal(satisfies('24.22.1', '~24.22'), false);
	});
});

describe('errorMessage', () => {
	test('unwraps Errors and stringifies anything else', () => {
		assert.equal(errorMessage(new Error('ENOENT: no such file')), 'ENOENT: no such file');
		assert.equal(errorMessage('plain failure'), 'plain failure');
	});
});

describe('npmVersion', () => {
	const okExec = (() => '11.19.0\n') as typeof execFileSync;
	const deadExec = (() => {
		throw new Error('npm: command not found');
	}) as typeof execFileSync;

	test('prefers the npm the package manager reported in the user agent', () => {
		const env = { npm_config_user_agent: 'npm/11.19.1 node/v24.22.1 darwin arm64' };
		assert.equal(npmVersion(env, deadExec), '11.19.1');
	});

	test('falls back to npm_version, then to asking npm itself', () => {
		assert.equal(npmVersion({ npm_version: '11.0.0' }, deadExec), '11.0.0');
		assert.equal(npmVersion({}, okExec), '11.19.0');
	});

	test('ignores a user agent that is not npm', () => {
		assert.equal(
			npmVersion({ npm_config_user_agent: 'yarn/1.22.0 npm/? node/v24.22.1', npm_version: '11.5.0' }, deadExec),
			'11.5.0'
		);
	});

	test('is undefined when npm cannot be asked either', () => {
		assert.equal(npmVersion({}, deadExec), undefined);
	});
});

/**
 * A throwaway repo root containing just the package.json and lockfile the
 * check reads - collectToolchainErrors never touches anything else.
 */
function withFixtureRoot(
	fixture: { packageJson?: unknown; lock?: unknown; packageJsonRaw?: string },
	fn: (fixtureRoot: string) => void
) {
	const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'check-toolchain-test-'));
	try {
		fs.writeFileSync(
			path.join(fixtureRoot, 'package.json'),
			fixture.packageJsonRaw ?? JSON.stringify(fixture.packageJson ?? {})
		);
		if (fixture.lock !== undefined) {
			fs.writeFileSync(path.join(fixtureRoot, 'package-lock.json'), JSON.stringify(fixture.lock));
		}
		fn(fixtureRoot);
	} finally {
		fs.rmSync(fixtureRoot, { recursive: true, force: true });
	}
}

const HEALTHY_PACKAGE_JSON = {
	engines: { node: '^24.22.1', npm: '>=11' },
	overrides: { preact: '^10.28.0' }
};

const HEALTHY_LOCK = {
	packages: {
		'node_modules/react': { version: '19.3.0' },
		'node_modules/react-dom': { version: '19.3.0' },
		'node_modules/scheduler': { version: '0.28.0' }
	}
};

const npmViaEnv = { npm_version: '11.19.0' };
const configProbe = ((command: string, args: string[] = []) =>
	args[0] === '-v' ? '11.19.0\n' : 'false\n') as typeof execFileSync;

describe('collectToolchainErrors', () => {
	test('reports nothing on an aligned toolchain', () => {
		withFixtureRoot({ packageJson: HEALTHY_PACKAGE_JSON, lock: HEALTHY_LOCK }, (fixtureRoot) => {
			assert.deepEqual(
				collectToolchainErrors({
					root: fixtureRoot,
					env: npmViaEnv,
					nodeVersion: '24.30.0',
					execFile: configProbe
				}),
				[]
			);
		});
	});

	test('reports a Node outside the engines range and npm that cannot be resolved', () => {
		withFixtureRoot({ packageJson: HEALTHY_PACKAGE_JSON, lock: HEALTHY_LOCK }, (fixtureRoot) => {
			const errors = collectToolchainErrors({
				root: fixtureRoot,
				env: {},
				nodeVersion: '25.0.0',
				execFile: (() => {
					throw new Error('npm: command not found');
				}) as typeof execFileSync
			});
			assert.ok(errors.some((message) => message.includes('Node 25.0.0 does not satisfy engines.node')));
			assert.ok(errors.some((message) => message.includes('npm (unknown) does not satisfy engines.npm')));
		});
	});

	test('reports an npm outside the engines range', () => {
		withFixtureRoot({ packageJson: HEALTHY_PACKAGE_JSON, lock: HEALTHY_LOCK }, (fixtureRoot) => {
			const errors = collectToolchainErrors({
				root: fixtureRoot,
				env: { npm_version: '10.9.9' },
				nodeVersion: '24.30.0',
				execFile: configProbe
			});
			assert.ok(errors.some((message) => message.includes('npm 10.9.9 does not satisfy engines.npm')));
		});
	});

	test('reports node and npm when package.json has no engines', () => {
		withFixtureRoot({ packageJson: { overrides: { preact: '^10.0.0' } }, lock: HEALTHY_LOCK }, (fixtureRoot) => {
			const errors = collectToolchainErrors({
				root: fixtureRoot,
				env: npmViaEnv,
				nodeVersion: '24.30.0',
				execFile: configProbe
			});
			assert.ok(errors.some((message) => message.includes('does not satisfy engines.node')));
			assert.ok(errors.some((message) => message.includes('does not satisfy engines.npm')));
		});
	});

	test('reports legacy-peer-deps=true, and ignores a config probe that cannot run', () => {
		withFixtureRoot({ packageJson: HEALTHY_PACKAGE_JSON, lock: HEALTHY_LOCK }, (fixtureRoot) => {
			const legacy = collectToolchainErrors({
				root: fixtureRoot,
				env: npmViaEnv,
				nodeVersion: '24.30.0',
				execFile: ((command: string, args: string[] = []) =>
					args.includes('legacy-peer-deps') ? 'true\n' : '11.19.0\n') as typeof execFileSync
			});
			assert.ok(legacy.some((message) => message.includes('legacy-peer-deps is true')));

			const probeFailed = collectToolchainErrors({
				root: fixtureRoot,
				env: npmViaEnv,
				nodeVersion: '24.30.0',
				execFile: ((command: string, args: string[] = []) => {
					if (args.includes('legacy-peer-deps')) throw new Error('npm config broke');
					return '11.19.0\n';
				}) as typeof execFileSync
			});
			assert.equal(
				probeFailed.some((message) => message.includes('legacy-peer-deps')),
				false
			);
		});
	});

	test('reports an unreadable lockfile and lockfile peers that are missing', () => {
		withFixtureRoot({ packageJson: HEALTHY_PACKAGE_JSON }, (fixtureRoot) => {
			const options = {
				root: fixtureRoot,
				env: npmViaEnv,
				nodeVersion: '24.30.0',
				execFile: configProbe
			};

			const missing = collectToolchainErrors(options);
			assert.ok(missing.some((message) => message.includes('Could not read package-lock.json')));

			fs.writeFileSync(
				path.join(fixtureRoot, 'package-lock.json'),
				JSON.stringify({ packages: { 'node_modules/react': { version: '19.3.0' } } })
			);
			const peers = collectToolchainErrors(options);
			assert.ok(peers.some((message) => message.includes('missing node_modules/react-dom')));
			assert.ok(peers.some((message) => message.includes('missing node_modules/scheduler')));

			// a lockfile without a packages map has no peer keys to check at all
			fs.writeFileSync(path.join(fixtureRoot, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3 }));
			const noPackages = collectToolchainErrors(options);
			assert.equal(
				noPackages.some((message) => message.includes('package-lock.json is missing')),
				false
			);
		});
	});

	test('reports a missing or wrong preact override, accepting ^10', () => {
		for (const overrides of [{}, { preact: '^8.5.3' }, { preact: '10.28.0' }]) {
			withFixtureRoot({ packageJson: { ...HEALTHY_PACKAGE_JSON, overrides }, lock: HEALTHY_LOCK }, (fixtureRoot) => {
				const errors = collectToolchainErrors({
					root: fixtureRoot,
					env: npmViaEnv,
					nodeVersion: '24.30.0',
					execFile: configProbe
				});
				assert.ok(
					errors.some((message) => message.includes('overrides.preact must be ^10.x')),
					`expected a preact override error for ${JSON.stringify(overrides)}`
				);
			});
		}
	});
});

// the isMain block only runs as a script, so these tests spawn the real CLI in a child
// process - child coverage still counts towards this file's numbers
const cliPath = fileURLToPath(new URL('./check-toolchain.ts', import.meta.url));

function runCli(env: NodeJS.ProcessEnv = {}): { stdout: string; status: number; stderr: string } {
	// npm run <script> exports npm_config_user_agent / npm_version for whatever npm is running
	// the tests - drop both so each case controls the version the script sees
	const childEnv = { ...process.env, ...env };
	delete childEnv.npm_config_user_agent;
	if (!('npm_version' in env)) {
		delete childEnv.npm_version;
	}
	try {
		const stdout = execFileSync(process.execPath, ['--experimental-strip-types', cliPath], {
			encoding: 'utf8',
			env: childEnv
		});
		return { stdout, status: 0, stderr: '' };
	} catch (error) {
		const failure = error as { status: number; stdout: string; stderr: string };
		return { stdout: failure.stdout ?? '', status: failure.status, stderr: failure.stderr ?? '' };
	}
}

describe('running as a script', () => {
	test('exits 0 immediately when SKIP_TOOLCHAIN_CHECK is set', () => {
		const result = runCli({ SKIP_TOOLCHAIN_CHECK: '1' });
		assert.equal(result.status, 0);
	});

	test('prints the toolchain versions on an aligned environment', () => {
		// pin the child's Node and npm versions so the answer doesn't depend on what
		// version of either the agent (or a local machine) happens to be running
		const cliUrl = pathToFileURL(cliPath).href;
		const harness = `
			Object.defineProperty(process.versions, 'node', { value: '24.99.0' });
			process.env.npm_version = '11.19.0';
			process.argv[1] = ${JSON.stringify(cliPath)};
			await import(${JSON.stringify(cliUrl)});
		`;
		const childEnv = { ...process.env, npm_version: '11.19.0' };
		delete childEnv.npm_config_user_agent;
		const stdout = execFileSync(
			process.execPath,
			['--input-type=module', '--experimental-strip-types', '--eval', harness],
			{ encoding: 'utf8', env: childEnv }
		);
		assert.match(stdout, /Toolchain OK: Node 24\.99\.0, npm 11\.19\.0/);
	});

	test('exits 1 with each problem listed when the toolchain drifts', () => {
		const result = runCli({ npm_version: '9.9.9', SKIP_TOOLCHAIN_CHECK: '0' });
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Toolchain check failed/);
		assert.match(result.stderr, /npm 9\.9\.9 does not satisfy engines\.npm/);
		assert.match(result.stderr, /SKIP_TOOLCHAIN_CHECK=1/);
	});
});
