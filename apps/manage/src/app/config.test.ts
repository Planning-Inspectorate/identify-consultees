import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { loadConfig, loadEnvironmentConfig, resetConfigCache } from './config.ts';

const requiredAuthEnv = {
	AUTH_CLIENT_ID: 'client-id',
	AUTH_CLIENT_SECRET: 'client-secret',
	AUTH_GROUP_APPLICATION_ACCESS: 'group-id',
	AUTH_TENANT_ID: 'tenant-id'
};

/** Keys this suite mutates — restored after each test. */
const managedKeys = [
	'APP_HOSTNAME',
	'AUTH_CLIENT_ID',
	'AUTH_CLIENT_SECRET',
	'AUTH_DISABLED',
	'AUTH_GROUP_APPLICATION_ACCESS',
	'AUTH_TENANT_ID',
	'ENVIRONMENT',
	'LOG_LEVEL',
	'CACHE_CONTROL_MAX_AGE',
	'NODE_ENV',
	'PORT',
	'PYTHON_FUNCTION_URL',
	'SESSION_SECRET',
	'SQL_CONNECTION_STRING'
] as const;

const originalEnv: Record<string, string | undefined> = {};
for (const key of managedKeys) {
	originalEnv[key] = process.env[key];
}

afterEach(() => {
	for (const key of managedKeys) {
		const value = originalEnv[key];
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	resetConfigCache();
});

function setBaseEnv(overrides: Record<string, string | undefined> = {}) {
	process.env.SESSION_SECRET = 'test-session-secret-at-least-32-chars';
	process.env.NODE_ENV = 'development';
	process.env.APP_HOSTNAME = 'localhost';
	process.env.SQL_CONNECTION_STRING = 'sqlserver://localhost:1434;database=test';
	process.env.PYTHON_FUNCTION_URL = 'http://localhost:7071/api/consultee-areas';
	for (const [key, value] of Object.entries({ ...requiredAuthEnv, ...overrides })) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
}

describe('manage loadConfig', () => {
	test('throws when SESSION_SECRET is missing', () => {
		setBaseEnv({ SESSION_SECRET: '' });
		assert.throws(() => loadConfig(), /SESSION_SECRET is required/);
	});

	test('does not throw when PYTHON_FUNCTION_URL is missing', () => {
		// only the consultee-areas-python page needs this - its absence shouldn't crash the app at boot
		// Empty string (not delete): loadEnvFile must not restore values from a local .env
		setBaseEnv({ PYTHON_FUNCTION_URL: '' });
		const config = loadConfig();
		assert.strictEqual(config.pythonFunctionUrl, undefined);
	});

	test('throws when PORT is not an integer', () => {
		setBaseEnv({ PORT: 'not-a-number' });
		assert.throws(() => loadConfig(), /PORT must be an integer/);
	});

	test('allows AUTH_DISABLED outside production', () => {
		setBaseEnv({
			AUTH_DISABLED: 'true',
			NODE_ENV: 'development',
			// Empty strings (not delete): loadEnvFile must not restore values from a local .env
			AUTH_CLIENT_ID: '',
			AUTH_CLIENT_SECRET: '',
			AUTH_GROUP_APPLICATION_ACCESS: '',
			AUTH_TENANT_ID: ''
		});
		const config = loadConfig();
		assert.equal(config.auth.disabled, true);
		assert.equal(config.auth.clientId, '');
		assert.equal(config.auth.clientSecret, '');
		assert.equal(config.auth.groups.applicationAccess, '');
	});

	test('does not allow AUTH_DISABLED in production', () => {
		setBaseEnv({
			AUTH_DISABLED: 'true',
			NODE_ENV: 'production',
			// Empty string (not delete): loadEnvFile must not restore values from a local .env
			AUTH_CLIENT_ID: ''
		});
		assert.throws(() => loadConfig(), /AUTH_CLIENT_ID must be a non-empty string/);
	});

	test('requires auth fields when auth is enabled', () => {
		setBaseEnv({
			AUTH_DISABLED: 'false',
			AUTH_CLIENT_ID: ''
		});
		assert.throws(() => loadConfig(), /AUTH_CLIENT_ID must be a non-empty string/);
	});

	test('loads successfully with required auth fields', () => {
		setBaseEnv({ AUTH_DISABLED: 'false' });
		const config = loadConfig();
		assert.equal(config.auth.disabled, false);
		assert.equal(config.auth.clientId, 'client-id');
		assert.equal(config.httpPort, 8090);
	});

	test('returns cached config on subsequent calls', () => {
		setBaseEnv({ AUTH_DISABLED: 'true', PORT: '8111' });
		const first = loadConfig();
		process.env.PORT = '8222';
		const second = loadConfig();
		assert.equal(first, second);
		assert.equal(second.httpPort, 8111);
	});

	test('parses a valid PORT override', () => {
		setBaseEnv({ AUTH_DISABLED: 'true', PORT: '9001' });
		const config = loadConfig();
		assert.equal(config.httpPort, 9001);
	});

	test('uses https when APP_HOSTNAME is not localhost', () => {
		setBaseEnv({ AUTH_DISABLED: 'true', APP_HOSTNAME: 'manage.example.gov.uk' });
		const config = loadConfig();
		assert.equal(config.appHostname, 'manage.example.gov.uk');
		assert.equal(config.auth.redirectUri, 'https://manage.example.gov.uk/auth/redirect');
	});

	test('defaults hostname and protocol when APP_HOSTNAME is missing', () => {
		// Empty string (not delete): loadEnvFile must not restore values from a local .env
		setBaseEnv({ AUTH_DISABLED: 'true', APP_HOSTNAME: '' });
		const config = loadConfig();
		assert.equal(config.appHostname, '');
		assert.equal(config.auth.redirectUri, 'https:///auth/redirect');
	});

	test('honours LOG_LEVEL and defaults NODE_ENV when unset', () => {
		setBaseEnv({
			AUTH_DISABLED: 'true',
			LOG_LEVEL: 'debug',
			CACHE_CONTROL_MAX_AGE: '2d',
			NODE_ENV: undefined
		});
		// Empty string would be falsy for NODE_ENV || 'development'; delete so loadEnvFile
		// cannot restore a local value either — chdir below covers the catch path.
		const previousCwd = process.cwd();
		const emptyDir = mkdtempSync(join(tmpdir(), 'manage-config-'));
		try {
			process.chdir(emptyDir);
			resetConfigCache();
			const config = loadConfig();
			assert.equal(config.logLevel, 'debug');
			assert.equal(config.cacheControl.maxAge, '2d');
			assert.equal(config.NODE_ENV, 'development');
		} finally {
			process.chdir(previousCwd);
		}
	});

	test('defaults LOG_LEVEL to info when unset', () => {
		// Empty string (not delete): loadEnvFile must not restore values from a local .env
		setBaseEnv({ AUTH_DISABLED: 'true', LOG_LEVEL: '' });
		const config = loadConfig();
		assert.equal(config.logLevel, 'info');
	});

	test('maps auth field values when auth is enabled', () => {
		setBaseEnv({ AUTH_DISABLED: 'false' });
		const config = loadConfig();
		assert.equal(config.auth.clientId, 'client-id');
		assert.equal(config.auth.clientSecret, 'client-secret');
		assert.equal(config.auth.groups.applicationAccess, 'group-id');
	});
});

describe('manage loadEnvironmentConfig', () => {
	test('throws when ENVIRONMENT is missing', () => {
		// Empty string (not delete): loadEnvFile must not restore values from a local .env
		process.env.ENVIRONMENT = '';
		assert.throws(() => loadEnvironmentConfig(), /ENVIRONMENT is required/);
	});

	test('throws when ENVIRONMENT is invalid', () => {
		process.env.ENVIRONMENT = 'staging';
		assert.throws(() => loadEnvironmentConfig(), /ENVIRONMENT must be one of/);
	});

	test('returns a valid ENVIRONMENT value', () => {
		process.env.ENVIRONMENT = 'dev';
		assert.equal(loadEnvironmentConfig(), 'dev');
	});

	test('continues when loadEnvFile throws', () => {
		process.env.ENVIRONMENT = 'dev';
		const previousCwd = process.cwd();
		const emptyDir = mkdtempSync(join(tmpdir(), 'manage-env-'));
		try {
			process.chdir(emptyDir);
			assert.equal(loadEnvironmentConfig(), 'dev');
		} finally {
			process.chdir(previousCwd);
		}
	});
});
