export function isDeadlockError(error: unknown): boolean {
	return error instanceof Error && /deadlock/i.test(error.message);
}

// A query that's merely *waiting* on a lock another transaction holds (not deadlocked - nothing
// cyclic for SQL Server's deadlock monitor to detect and resolve) surfaces client-side as this
// request-timeout message once it's waited longer than the driver's own timeout - confirmed for
// real: a ruleset's own batch of conditions run concurrently against each other (see
// geospatial/rulesets.ts) hit exactly this under enough concurrent load. Just as retryable as a
// deadlock - the same underlying cause (concurrent access to the same table), just a different
// surfaced error shape - so it's treated the same way below.
function isLockWaitTimeoutError(error: unknown): boolean {
	return error instanceof Error && /Timeout: Request failed to complete/i.test(error.message);
}

/**
 * Retry `fn` on a SQL Server deadlock ("... has been chosen as the deadlock victim. Rerun the
 * transaction.") or lock-wait timeout (see isLockWaitTimeoutError) - both a normal, expected
 * outcome of concurrent access to the same table, not a bug. Confirmed for real, not
 * hypothetically: concurrent test files reading/writing consultee_area and case_boundary at the
 * same time (and a ruleset's own batch of conditions, see geospatial/rulesets.ts) have each
 * produced both. Any query against either table can hit one, not just ones made from a particular
 * caller, so this is applied at the query layer in both modules. Any other error is rethrown as-is.
 */
export async function withDeadlockRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await fn();
		} catch (error) {
			if ((!isDeadlockError(error) && !isLockWaitTimeoutError(error)) || attempt >= retries) {
				throw error;
			}
			// small randomised backoff so retried queries don't immediately re-collide
			await new Promise((resolve) => setTimeout(resolve, 25 + Math.random() * 75));
		}
	}
}
