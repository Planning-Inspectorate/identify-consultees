import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';

/**
 * Skip a database-backed test when the local SQL Server isn't up (see docker-compose.yml).
 *
 * In CI the database container is always brought up before the tests run, so an unavailable
 * database there means the bring-up failed or the connection string is wrong - failing loudly
 * names the cause in the failing test itself, rather than silently skipping the suite and
 * surfacing only as an unrelated-looking coverage miss. The CI-only suites (which empty real
 * tables) skip by a different condition and don't use this.
 */
export function skipIfDbUnavailable(t: TestContext): void {
	if (process.env.CI || process.env.TF_BUILD) {
		assert.fail(
			'SQL Server database not available - CI brings it up before the tests, so the bring-up or SQL_CONNECTION_STRING is broken'
		);
	}
	t.skip('SQL Server database not available');
}
