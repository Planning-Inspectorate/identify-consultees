import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { withExtendedTimeout } from './index.ts';

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
