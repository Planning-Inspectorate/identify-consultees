import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { loadConfig } from './config.ts';

const managedKeys = ['EXAMPLE_SCHEDULE', 'SQL_CONNECTION_STRING'] as const;
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
});

describe('function loadConfig', () => {
	test('throws when SQL_CONNECTION_STRING is missing', () => {
		delete process.env.SQL_CONNECTION_STRING;
		assert.throws(() => loadConfig(), /SQL_CONNECTION_STRING is required/);
	});

	test('loads with default example schedule', () => {
		process.env.SQL_CONNECTION_STRING = 'sqlserver://localhost:1434;database=test';
		delete process.env.EXAMPLE_SCHEDULE;
		const config = loadConfig();
		assert.equal(config.database.connectionString, 'sqlserver://localhost:1434;database=test');
		assert.equal(config.example.schedule, '0 0 0 * * *');
	});

	test('uses EXAMPLE_SCHEDULE when provided', () => {
		process.env.SQL_CONNECTION_STRING = 'sqlserver://localhost:1434;database=test';
		process.env.EXAMPLE_SCHEDULE = '0 */5 * * * *';
		const config = loadConfig();
		assert.equal(config.example.schedule, '0 */5 * * * *');
	});
});
