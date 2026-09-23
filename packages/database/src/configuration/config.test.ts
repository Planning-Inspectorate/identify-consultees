import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { loadConfig } from './config.ts';

const original = process.env.SQL_CONNECTION_STRING;

afterEach(() => {
	if (original === undefined) {
		delete process.env.SQL_CONNECTION_STRING;
	} else {
		process.env.SQL_CONNECTION_STRING = original;
	}
});

describe('database loadConfig', () => {
	test('throws when SQL_CONNECTION_STRING is missing', () => {
		delete process.env.SQL_CONNECTION_STRING;
		assert.throws(() => loadConfig(), /SQL_CONNECTION_STRING is required/);
	});

	test('returns the connection string', () => {
		process.env.SQL_CONNECTION_STRING = 'sqlserver://localhost:1434;database=test';
		assert.deepEqual(loadConfig(), { db: 'sqlserver://localhost:1434;database=test' });
	});
});
