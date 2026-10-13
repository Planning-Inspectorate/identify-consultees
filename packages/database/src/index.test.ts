import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import type { Logger } from 'pino';
import { pino } from 'pino';
// the same specifier index.ts uses - the generated client's class identity differs depending on
// whether it's reached through the package specifier or a relative path, and only the former is
// the class initDatabaseClient/newDatabaseClient instantiate
import { PrismaClient } from '@pins/identify-consultees-database/src/client/client.ts';
import { initDatabaseClient, newDatabaseClient, withExtendedTimeout } from './index.ts';

const TEST_CONNECTION_STRING =
	'sqlserver://localhost:1434;database=identify-consultees;user=sa;password=pw;trustServerCertificate=true';

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
				database: { connectionString: TEST_CONNECTION_STRING },
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

	test('does not wire Prisma log events in production', async () => {
		const on = mock.method(PrismaClient.prototype, '$on', () => undefined);
		try {
			const client = initDatabaseClient(
				{
					database: { connectionString: TEST_CONNECTION_STRING },
					NODE_ENV: 'production'
				},
				pino({ enabled: false })
			);
			try {
				assert.equal(on.mock.callCount(), 0);
			} finally {
				await client.$disconnect();
			}
		} finally {
			on.mock.restore();
		}
	});
});

describe('newDatabaseClient logging', () => {
	// the adapter doesn't connect until the first query, so a well-formed (but pointing nowhere)
	// string still exercises the event wiring - $on is stubbed to capture the handlers rather than
	// relying on a real query's timing
	test('forwards each Prisma log event to the provided logger', async () => {
		const handlers = new Map<string, (event: never) => void>();
		const on = mock.method(PrismaClient.prototype, '$on', function (
			this: PrismaClient,
			eventType: string,
			callback: never
		) {
			handlers.set(eventType, callback);
			return this;
		} as never);
		const logger = {
			debug: mock.fn(),
			error: mock.fn(),
			warn: mock.fn()
		} as unknown as Logger;
		try {
			const client = newDatabaseClient(TEST_CONNECTION_STRING, logger);
			try {
				assert.deepEqual([...handlers.keys()].sort(), ['error', 'info', 'query', 'warn']);

				handlers.get('query')!({ query: 'SELECT 1', params: '[]', duration: 3 } as never);
				handlers.get('error')!({ message: 'boom' } as never);
				handlers.get('info')!({ message: 'fyi' } as never);
				handlers.get('warn')!({ message: 'careful' } as never);

				// query and info events both land on debug
				assert.equal(logger.debug.mock.callCount(), 2);
				assert.deepEqual(logger.debug.mock.calls[0].arguments[0], {
					query: 'SELECT 1',
					params: '[]',
					duration: 3
				});
				assert.equal(logger.debug.mock.calls[0].arguments[1], 'Prisma query');
				assert.equal(logger.error.mock.callCount(), 1);
				assert.equal(logger.warn.mock.callCount(), 1);
			} finally {
				await client.$disconnect();
			}
		} finally {
			on.mock.restore();
		}
	});

	test('registers no handlers when no logger is given', async () => {
		const on = mock.method(PrismaClient.prototype, '$on', () => undefined);
		try {
			const client = newDatabaseClient(TEST_CONNECTION_STRING);
			try {
				assert.equal(on.mock.callCount(), 0);
			} finally {
				await client.$disconnect();
			}
		} finally {
			on.mock.restore();
		}
	});
});
