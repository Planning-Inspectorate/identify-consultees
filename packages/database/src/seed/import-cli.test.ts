import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseArgs } from './import-cli.ts';

describe('parseArgs', () => {
	test('parses a valid consultee-areas import', () => {
		assert.deepEqual(parseArgs(['--type=consultee-areas', '--file=/data/ref.geojson']), {
			type: 'consultee-areas',
			file: '/data/ref.geojson',
			batchSize: undefined
		});
	});

	test('parses an optional positive batch size', () => {
		assert.deepEqual(parseArgs(['--type=case-boundaries', '--file=./a.geojson', '--batch-size=25']), {
			type: 'case-boundaries',
			file: './a.geojson',
			batchSize: 25
		});
	});

	test('rejects an unknown or missing type', () => {
		assert.throws(() => parseArgs(['--file=./a.geojson']), /--type must be/);
		assert.throws(() => parseArgs(['--type=widgets', '--file=./a.geojson']), /--type must be/);
	});

	test('rejects a missing file path', () => {
		assert.throws(() => parseArgs(['--type=consultee-areas']), /--file is required/);
	});

	test('rejects a non-positive batch size', () => {
		assert.throws(
			() => parseArgs(['--type=consultee-areas', '--file=./a.geojson', '--batch-size=0']),
			/--batch-size must be a positive integer/
		);
		assert.throws(
			() => parseArgs(['--type=consultee-areas', '--file=./a.geojson', '--batch-size=nope']),
			/--batch-size must be a positive integer/
		);
	});
});
