import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { findDummyGeometry, findRulesetLabel } from './dummy-geometries.ts';

describe('dummy geometries helpers', () => {
	test('findDummyGeometry returns a known row or undefined', () => {
		assert.equal(findDummyGeometry('geo-1')?.reference, 'EN010024');
		assert.equal(findDummyGeometry('missing'), undefined);
	});

	test('findRulesetLabel returns the label for a known ruleset', () => {
		assert.equal(findRulesetLabel('scotland'), 'Scotland');
	});

	test('findRulesetLabel falls back to the raw value when unknown', () => {
		assert.equal(findRulesetLabel('unknown-ruleset'), 'unknown-ruleset');
	});
});
