import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { withExtendedTimeout } from './index.ts';

describe('withExtendedTimeout', () => {
	test('appends a socketTimeout segment to the connection string', () => {
		const result = withExtendedTimeout('sqlserver://host:1433;database=db;user=u;password=p', 120_000);
		assert.equal(result, 'sqlserver://host:1433;database=db;user=u;password=p;socketTimeout=120000');
	});
});
