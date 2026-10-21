import assert from 'node:assert';
import { describe, it } from 'node:test';
import { loadScreeningConfig, parseScreeningConfig } from './screening-config.ts';

describe('screening config', () => {
	it('loads the shipped config/screening.yaml', () => {
		assert.ok(loadScreeningConfig().boundingBoxAbovePoints > 0);
	});

	it('reads how detailed a site can be before its bounding box is screened - 0 never', () => {
		assert.deepStrictEqual(parseScreeningConfig('version: 1\nboundingBoxAbovePoints: 2000'), {
			boundingBoxAbovePoints: 2000
		});
		assert.deepStrictEqual(parseScreeningConfig('version: 1\nboundingBoxAbovePoints: 0'), {
			boundingBoxAbovePoints: 0
		});
	});

	for (const [name, text, error] of [
		['an empty file', '', /version 1 document/],
		['the wrong version', 'version: 2\nboundingBoxAbovePoints: 2000', /version 1 document/],
		['no limit', 'version: 1', /boundingBoxAbovePoints must be/],
		['a negative limit', 'version: 1\nboundingBoxAbovePoints: -1', /boundingBoxAbovePoints must be/],
		['a fraction', 'version: 1\nboundingBoxAbovePoints: 2.5', /boundingBoxAbovePoints must be/],
		['words', 'version: 1\nboundingBoxAbovePoints: lots', /boundingBoxAbovePoints must be/]
	] as const) {
		it(`rejects ${name}`, () => {
			assert.throws(() => parseScreeningConfig(text), error);
		});
	}
});
