import { mockLogger } from '#lib/testing/index.ts';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { activeTestFault, requestTestFault, TEST_FAULT_SESSION_FIELD, testFaultMiddleware } from './test-faults.ts';

function middlewareRequest(query: Record<string, unknown>, session?: Record<string, unknown>) {
	return {
		query,
		...(session ? { session } : {})
	};
}

function run(middleware: ReturnType<typeof testFaultMiddleware>, req: ReturnType<typeof middlewareRequest>) {
	const next = mock.fn();
	middleware(req as never, {} as never, next);
	return next;
}

describe('testFaultMiddleware', () => {
	const enabled = testFaultMiddleware({ testFaultsEnabled: true, logger: mockLogger() });

	it('stores the session faults in the session', () => {
		for (const fault of ['ruleset'] as const) {
			const session: Record<string, unknown> = {};
			const next = run(enabled, middlewareRequest({ 'test-fail': fault }, session));
			assert.equal(session[TEST_FAULT_SESSION_FIELD], fault);
			assert.equal(next.mock.callCount(), 1);
		}
	});

	it('does not store the per-request faults - they fail their own request only', () => {
		for (const fault of ['map', 'download'] as const) {
			const session: Record<string, unknown> = {};
			const next = run(enabled, middlewareRequest({ 'test-fail': fault }, session));
			assert.equal(session[TEST_FAULT_SESSION_FIELD], undefined);
			assert.equal(next.mock.callCount(), 1);
		}
	});

	it('takes the first of repeated params', () => {
		const session: Record<string, unknown> = {};
		run(enabled, middlewareRequest({ 'test-fail': ['ruleset', 'map'] }, session));
		assert.equal(session[TEST_FAULT_SESSION_FIELD], 'ruleset');
	});

	it("clears the fault on 'off' and leaves it alone on anything unrecognised", () => {
		const session: Record<string, unknown> = { [TEST_FAULT_SESSION_FIELD]: 'ruleset' };
		run(enabled, middlewareRequest({ 'test-fail': 'not-a-fault' }, session));
		assert.equal(session[TEST_FAULT_SESSION_FIELD], 'ruleset');
		run(enabled, middlewareRequest({ 'test-fail': 'off' }, session));
		assert.equal(session[TEST_FAULT_SESSION_FIELD], undefined);
	});

	it('does nothing without a param, without a session, or while disabled', () => {
		const session: Record<string, unknown> = {};
		assert.equal(run(enabled, middlewareRequest({}, session)).mock.callCount(), 1);
		assert.equal(session[TEST_FAULT_SESSION_FIELD], undefined);
		assert.equal(run(enabled, middlewareRequest({ 'test-fail': 'map' })).mock.callCount(), 1);

		const disabled = testFaultMiddleware({ testFaultsEnabled: false, logger: mockLogger() });
		run(disabled, middlewareRequest({ 'test-fail': 'ruleset' }, session));
		assert.equal(session[TEST_FAULT_SESSION_FIELD], undefined);
	});
});

describe('activeTestFault', () => {
	const enabled = { testFaultsEnabled: true };

	it('returns the stored session fault while enabled', () => {
		assert.equal(activeTestFault(enabled, { [TEST_FAULT_SESSION_FIELD]: 'ruleset' }), 'ruleset');
	});

	it('ignores a stored per-request fault - they are never session faults', () => {
		assert.equal(activeTestFault(enabled, { [TEST_FAULT_SESSION_FIELD]: 'map' }), undefined);
		assert.equal(activeTestFault(enabled, { [TEST_FAULT_SESSION_FIELD]: 'download' }), undefined);
	});

	it('is undefined while disabled, without a store, or for a stored value that is no fault', () => {
		assert.equal(activeTestFault({ testFaultsEnabled: false }, { [TEST_FAULT_SESSION_FIELD]: 'ruleset' }), undefined);
		assert.equal(activeTestFault(enabled, undefined), undefined);
		assert.equal(activeTestFault(enabled, {}), undefined);
		assert.equal(activeTestFault(enabled, { [TEST_FAULT_SESSION_FIELD]: 'not-a-fault' }), undefined);
	});
});

describe('requestTestFault', () => {
	const enabled = { testFaultsEnabled: true };

	it('returns the per-request fault named on the request', () => {
		assert.equal(requestTestFault(enabled, { 'test-fail': 'map' }), 'map');
		assert.equal(requestTestFault(enabled, { 'test-fail': 'download' }), 'download');
		assert.equal(requestTestFault(enabled, { 'test-fail': ['download', 'map'] }), 'download');
		// a session fault on the query is not a request fault, nor is anything unrecognised
		assert.equal(requestTestFault(enabled, { 'test-fail': 'ruleset' }), undefined);
		assert.equal(requestTestFault(enabled, {}), undefined);
		assert.equal(requestTestFault(enabled, undefined), undefined);
	});

	it('is undefined while the triggers are disabled', () => {
		assert.equal(requestTestFault({ testFaultsEnabled: false }, { 'test-fail': 'map' }), undefined);
		assert.equal(requestTestFault({ testFaultsEnabled: false }, { 'test-fail': 'download' }), undefined);
	});
});
