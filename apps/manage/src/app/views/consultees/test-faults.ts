import type { ManageService } from '#service';
import type { RequestHandler } from 'express';

/**
 * Test-only fault triggers, for QA exercising the service's error states on a deployed
 * environment. TEMPORARY - remove before go-live (see kt-docs/overview.md's "Before go-live").
 *
 * Where they're on (everywhere but prod - see Config.testFaultsEnabled), `?test-fail=<fault>`
 * on any /consultees page stores the fault in the session; the named dependency then fails on
 * every page until `?test-fail=off` clears it - a backend outage, not a one-off error:
 *
 *   - `map`      - the project boundary page's map fails to load ("There's a problem loading
 *                  the map - try again later")
 *   - `ruleset`  - every ruleset run fails ("The ruleset could not be run")
 *   - `download` - the report ZIP fails to build ("The scoping report could not be downloaded
 *                  - try again")
 */

export const TEST_FAULT_QUERY_PARAM = 'test-fail';
export const TEST_FAULT_SESSION_FIELD = 'testFault';
export const TEST_FAULTS = ['map', 'ruleset', 'download'] as const;
export type TestFault = (typeof TEST_FAULTS)[number];

function isTestFault(value: unknown): value is TestFault {
	return (TEST_FAULTS as readonly string[]).includes(String(value));
}

// run-ruleset.ts's own, inlined: runRulesetSafely reads this module, so importing it back would
// make the two circular
function firstQueryValue(value: unknown): string {
	const first = Array.isArray(value) ? value[0] : value;
	return typeof first === 'string' ? first : '';
}

/**
 * Syncs `?test-fail=` into the session: a named fault is set, `off` clears, anything else (or a
 * disabled flag) leaves the session alone.
 */
export function testFaultMiddleware(service: Pick<ManageService, 'testFaultsEnabled' | 'logger'>): RequestHandler {
	return (req, _res, next) => {
		const requested = firstQueryValue(req.query?.[TEST_FAULT_QUERY_PARAM]);
		if (service.testFaultsEnabled && req.session && requested) {
			if (requested === 'off') {
				delete (req.session as Record<string, unknown>)[TEST_FAULT_SESSION_FIELD];
				service.logger.info('test fault cleared');
			} else if (isTestFault(requested)) {
				(req.session as Record<string, unknown>)[TEST_FAULT_SESSION_FIELD] = requested;
				service.logger.warn({ fault: requested }, 'test fault set - failures are forced until cleared');
			}
		}
		next();
	};
}

/**
 * The fault the session asked for - undefined while the triggers are disabled, none is set, or
 * what's stored isn't a known fault.
 */
export function activeTestFault(
	service: Pick<ManageService, 'testFaultsEnabled'> | { testFaultsEnabled?: boolean },
	store: Record<string, unknown> | undefined
): TestFault | undefined {
	if (!service.testFaultsEnabled) {
		return undefined;
	}
	const fault = store?.[TEST_FAULT_SESSION_FIELD];
	return isTestFault(fault) ? fault : undefined;
}
