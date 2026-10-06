export function isDeadlockError(error: unknown): boolean {
	return error instanceof Error && /deadlock/i.test(error.message);
}

/**
 * Retry `fn` on a SQL Server deadlock ("... has been chosen as the deadlock victim. Rerun the
 * transaction.") - a normal, expected outcome of concurrent access to the same table, not a bug:
 * concurrent test files reading/writing consultee_area and case_boundary at the same time (and a
 * ruleset's own batch of conditions, see geospatial/rulesets.ts) have produced them. Any query
 * against either table can hit one, so this is applied at the query layer in both modules.
 *
 * A client-side request timeout ("Timeout: Request failed to complete in Nms") is deliberately
 * *not* retried: it can't distinguish a query waiting on a lock from one that's simply slow, and
 * re-running a slow spatial query just repeats the whole wait - with the app's 45s timeout and 3
 * retries, one slow query held a results page for minutes before failing.
 */
export async function withDeadlockRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await fn();
		} catch (error) {
			if (!isDeadlockError(error) || attempt >= retries) {
				throw error;
			}
			// small randomised backoff so retried queries don't immediately re-collide
			await new Promise((resolve) => setTimeout(resolve, 25 + Math.random() * 75));
		}
	}
}
