import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { afterEach, describe, mock, test } from 'node:test';
import { skipIfDbUnavailable } from './db-test-skip.ts';

describe('skipIfDbUnavailable', () => {
	const savedEnv: Record<string, string | undefined> = {};

	afterEach(() => {
		for (const name of ['CI', 'TF_BUILD']) {
			if (savedEnv[name] === undefined) {
				delete process.env[name];
			} else {
				process.env[name] = savedEnv[name];
			}
			delete savedEnv[name];
		}
	});

	function withoutCi() {
		for (const name of ['CI', 'TF_BUILD']) {
			savedEnv[name] = process.env[name];
			delete process.env[name];
		}
	}

	test('skips when no database is available outside CI', () => {
		withoutCi();
		const t = { skip: mock.fn() };
		skipIfDbUnavailable(t as unknown as TestContext);
		assert.equal(t.skip.mock.callCount(), 1);
	});

	test('fails rather than skips under CI', () => {
		withoutCi();
		process.env.CI = 'true';
		assert.throws(() => skipIfDbUnavailable({} as TestContext), /SQL Server database not available - CI brings it up/);
	});

	test('fails rather than skips under Azure Pipelines (TF_BUILD)', () => {
		withoutCi();
		process.env.TF_BUILD = 'True';
		assert.throws(() => skipIfDbUnavailable({} as TestContext), /SQL Server database not available - CI brings it up/);
	});
});
