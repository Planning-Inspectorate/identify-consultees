import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// DO NOT MERGE - this file exists only to verify how the Azure pipeline reports a
// test-stage failure. Remove it with the test PR that introduced it.
describe('deliberate pipeline failure check', () => {
	it('always fails', () => {
		assert.fail('deliberate failure to check CI behaviour - this PR must not be merged');
	});
});
