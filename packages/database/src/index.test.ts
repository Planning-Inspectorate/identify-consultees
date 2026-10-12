import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { pino } from 'pino';
import { initDatabaseClient, withExtendedTimeout } from './index.ts';

describe('withExtendedTimeout', () => {
	test('appends a socketTimeout segment to the connection string', () => {
		const result = withExtendedTimeout('sqlserver://host:1433;database=db;user=u;password=p', 120_000);
		assert.equal(result, 'sqlserver://host:1433;database=db;user=u;password=p;socketTimeout=120000');
	});

	test('keeps the original connection string prefix intact when extending timeout', () => {
		const base =
			'sqlserver://localhost:1434;database=identify-consultees;user=sa;password=pw;trustServerCertificate=true';
		const result = withExtendedTimeout(base, 60_000);
		assert.match(result, /^sqlserver:\/\/localhost:1434;/);
		assert.match(result, /;socketTimeout=60000$/);
		assert.match(result, /trustServerCertificate=true/);
	});
});

describe('initDatabaseClient', () => {
	test('throws when the config has no connection string', () => {
		assert.throws(
			() => initDatabaseClient({ database: {}, NODE_ENV: 'test' }, pino({ enabled: false })),
			/database connectionString is required/
		);
	});

	// the adapter parses the string but doesn't connect until the first query, so a well-formed
	// (but pointing nowhere) string is enough to build the client and wire up Prisma's log events
	test('builds a client without opening a connection', async () => {
		const client = initDatabaseClient(
			{
				database: {
					connectionString:
						'sqlserver://localhost:1434;database=identify-consultees;user=sa;password=pw;trustServerCertificate=true'
				},
				NODE_ENV: 'test'
			},
			pino({ enabled: false })
		);
		try {
			// duck-typed rather than instanceof - the generated client's class identity differs
			// depending on whether it's reached through the package specifier or a relative path
			assert.equal(typeof client.$queryRaw, 'function');
			assert.equal(typeof client.$disconnect, 'function');
		} finally {
			await client.$disconnect();
		}
	});
});
