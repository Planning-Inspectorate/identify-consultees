import type { ManageService } from '#service';
import type { RequestHandler } from 'express';

/**
 * Test-only fault triggers, for QA exercising the service's error states on a deployed
 * environment. TEMPORARY - remove before go-live (see kt-docs/overview.md's "Before go-live").
 *
 * Where they're on (everywhere but prod - see Config.testFaultsEnabled), `?test-fail=<fault>`
 * on a /consultees page forces the named failure:
 *
 *   - `map`      - the project boundary page's map fails to load ("There's a problem loading
 *                  the map - try again later")
 *   - `ruleset`  - every ruleset run fails ("The ruleset could not be run")
 *   - `download` - the report ZIP fails to build ("The scoping report could not be downloaded
 *                  - try again")
 *
 * `ruleset` is stored in the session - a real outage fails every page until it's fixed, and it
 * has to survive the journey's navigation - until `?test-fail=off` on any /consultees page
 * clears it. `map` and `download` are per-request: they fail only the request carrying the
 * parameter and are never stored, so a shared URL can't leave a tester's session broken.
 */

export const TEST_FAULT_QUERY_PARAM = 'test-fail';
export const TEST_FAULT_SESSION_FIELD = 'testFault';
/** The faults held in the session - every page fails until `?test-fail=off`. */
export const SESSION_TEST_FAULTS = ['ruleset'] as const;
export type SessionTestFault = (typeof SESSION_TEST_FAULTS)[number];
/** The per-request faults - they fail the request carrying the parameter, nothing more. */
export const REQUEST_TEST_FAULTS = ['map', 'download'] as const;
export type RequestTestFault = (typeof REQUEST_TEST_FAULTS)[number];
export const TEST_FAULTS = [...REQUEST_TEST_FAULTS, ...SESSION_TEST_FAULTS] as const;
export type TestFault = (typeof TEST_FAULTS)[number];

function isSessionTestFault(value: unknown): value is SessionTestFault {
	return (SESSION_TEST_FAULTS as readonly string[]).includes(String(value));
}

function isRequestTestFault(value: unknown): value is RequestTestFault {
	return (REQUEST_TEST_FAULTS as readonly string[]).includes(String(value));
}

// run-ruleset.ts's own, inlined: runRulesetSafely reads this module, so importing it back would
// make the two circular
function firstQueryValue(value: unknown): string {
	const first = Array.isArray(value) ? value[0] : value;
	return typeof first === 'string' ? first : '';
}

/**
 * Syncs `?test-fail=` into the session: a session fault is set, `off` clears, anything else
 * (or a disabled flag) leaves the session alone. The per-request faults are never stored -
 * they apply to the request carrying them and nowhere else (see requestTestFault).
 */
export function testFaultMiddleware(service: Pick<ManageService, 'testFaultsEnabled' | 'logger'>): RequestHandler {
	return (req, _res, next) => {
		const requested = firstQueryValue(req.query?.[TEST_FAULT_QUERY_PARAM]);
		if (service.testFaultsEnabled && req.session && requested) {
			if (requested === 'off') {
				delete (req.session as Record<string, unknown>)[TEST_FAULT_SESSION_FIELD];
				service.logger.info('test fault cleared');
			} else if (isSessionTestFault(requested)) {
				(req.session as Record<string, unknown>)[TEST_FAULT_SESSION_FIELD] = requested;
				service.logger.warn({ fault: requested }, 'test fault set - failures are forced until cleared');
			}
		}
		next();
	};
}

/**
 * The fault the session asked for - undefined while the triggers are disabled, none is set, or
 * what's stored isn't a session fault.
 */
export function activeTestFault(
	service: Pick<ManageService, 'testFaultsEnabled'> | { testFaultsEnabled?: boolean },
	store: Record<string, unknown> | undefined
): SessionTestFault | undefined {
	if (!service.testFaultsEnabled) {
		return undefined;
	}
	const fault = store?.[TEST_FAULT_SESSION_FIELD];
	return isSessionTestFault(fault) ? fault : undefined;
}

/**
 * The per-request fault named on this request (`map` or `download`), or undefined. Never
 * stored, so a tester's session can't be left failing - the next plain request works again.
 */
export function requestTestFault(
	service: Pick<ManageService, 'testFaultsEnabled'> | { testFaultsEnabled?: boolean },
	query: unknown
): RequestTestFault | undefined {
	if (!service.testFaultsEnabled) {
		return undefined;
	}
	const requested = firstQueryValue((query as Record<string, unknown> | undefined)?.[TEST_FAULT_QUERY_PARAM]);
	return isRequestTestFault(requested) ? requested : undefined;
}
