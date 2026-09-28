import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { buildManageTestConfig } from './create-test-app.ts';

describe('buildManageTestConfig', () => {
	let originalConnectionString: string | undefined;

	beforeEach(() => {
		originalConnectionString = process.env.SQL_CONNECTION_STRING;
	});

	afterEach(() => {
		if (originalConnectionString === undefined) {
			delete process.env.SQL_CONNECTION_STRING;
		} else {
			process.env.SQL_CONNECTION_STRING = originalConnectionString;
		}
	});

	test('uses SQL_CONNECTION_STRING when set (e.g. CI SQL Server container)', () => {
		process.env.SQL_CONNECTION_STRING = 'sqlserver://ci-host:12345;database=identify-consultees';
		const config = buildManageTestConfig();
		assert.equal(config.database.connectionString, 'sqlserver://ci-host:12345;database=identify-consultees');
	});

	test('falls back to the docker-compose connection string when unset', () => {
		delete process.env.SQL_CONNECTION_STRING;
		const config = buildManageTestConfig();
		assert.equal(
			config.database.connectionString,
			'sqlserver://localhost:1434;database=identify-consultees;user=sa;password=DockerDatabaseP@22word!;trustServerCertificate=true'
		);
	});
});
