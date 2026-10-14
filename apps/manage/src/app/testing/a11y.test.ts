import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { assertNoSeriousA11yViolations } from './a11y.ts';

describe('assertNoSeriousA11yViolations', () => {
	test('passes a page with only moderate violations', async () => {
		// no <main> landmark - moderate, so not a failure
		await assertNoSeriousA11yViolations(
			'<!DOCTYPE html><html lang="en"><head><title>Page</title></head><body><p>No landmarks</p></body></html>'
		);
	});

	test('fails a page with critical or serious violations, naming each', async () => {
		// an image without alt text is critical; a page without a language, serious
		await assert.rejects(
			assertNoSeriousA11yViolations(
				'<!DOCTYPE html><html><head><title>Page</title></head><body><main><img src="map.png"></main></body></html>'
			),
			(error: Error) => /image-alt/.test(error.message) && /html-has-lang/.test(error.message)
		);
	});
});
