import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeCaseSector } from './sector.ts';

describe('describeCaseSector', () => {
	it('derives sector and type from the reference code', () => {
		assert.strictEqual(describeCaseSector('EN0110007', 'Longfield Solar Farm'), 'Energy, Generating Stations, Solar');
		assert.strictEqual(describeCaseSector('TR040001', 'Example Railway'), 'Transport, Railways');
		assert.strictEqual(describeCaseSector('WA020123', 'Reservoir scheme'), 'Water, Transfer of Water Resources');
		assert.strictEqual(
			describeCaseSector('BC030042', 'Plant upgrade'),
			'Business or Commercial, An Industrial Process or Processes'
		);
	});

	it('prefers the more specific energy sub-type keyword', () => {
		assert.strictEqual(
			describeCaseSector('EN010025', 'East Anglia ONE Offshore Windfarm'),
			'Energy, Generating Stations, Offshore wind'
		);
		assert.strictEqual(describeCaseSector('EN010077', 'Tidal Lagoon Power'), 'Energy, Generating Stations, Tidal');
		// an unqualified "wind farm" is treated as onshore
		assert.strictEqual(
			describeCaseSector('EN010013', 'Clocaenog Forest Wind Farm'),
			'Energy, Generating Stations, Onshore wind'
		);
	});

	it('only guesses an energy sub-type for generating stations', () => {
		// EN06 is a pipeline type - "gas" in the name must not produce a generating-station sub-type
		assert.strictEqual(
			describeCaseSector('EN060004', 'River Humber Gas Pipeline Replacement Project'),
			'Energy, Gas Transporter Pipe-lines'
		);
	});

	it('falls back to the sector alone when the type code is unknown', () => {
		assert.strictEqual(describeCaseSector('EN990001', 'New kind of project'), 'Energy');
	});

	it('returns null for references without a known sector code', () => {
		assert.strictEqual(describeCaseSector('ZZ000001', 'Router Test Fixture Wind Farm'), null);
		assert.strictEqual(describeCaseSector('', 'No reference'), null);
	});
});
