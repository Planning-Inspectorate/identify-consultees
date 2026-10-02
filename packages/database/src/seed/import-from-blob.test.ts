import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { downloadBlobToTempFile, parseArgs } from './import-from-blob.ts';

describe('parseArgs', () => {
	test('parses a valid consultee-areas import', () => {
		assert.deepEqual(parseArgs(['--type=consultee-areas', '--blob=combined_reference_data_v1.geojson']), {
			type: 'consultee-areas',
			blob: 'combined_reference_data_v1.geojson',
			batchSize: undefined
		});
	});

	test('parses an optional positive batch size', () => {
		assert.deepEqual(
			parseArgs(['--type=case-boundaries', '--blob=all-project-boundaries.geojson', '--batch-size=25']),
			{
				type: 'case-boundaries',
				blob: 'all-project-boundaries.geojson',
				batchSize: 25
			}
		);
	});

	test('rejects an unknown or missing type', () => {
		assert.throws(() => parseArgs(['--blob=a.geojson']), /--type must be/);
		assert.throws(() => parseArgs(['--type=widgets', '--blob=a.geojson']), /--type must be/);
	});

	test('rejects a missing blob name', () => {
		assert.throws(() => parseArgs(['--type=consultee-areas']), /--blob is required/);
	});

	test('rejects a non-positive batch size', () => {
		assert.throws(
			() => parseArgs(['--type=consultee-areas', '--blob=a.geojson', '--batch-size=0']),
			/--batch-size must be a positive integer/
		);
		assert.throws(
			() => parseArgs(['--type=consultee-areas', '--blob=a.geojson', '--batch-size=nope']),
			/--batch-size must be a positive integer/
		);
	});
});

describe('downloadBlobToTempFile', () => {
	test('requires BLOB_STORE_HOST and BLOB_STORE_CONTAINER to be set', async () => {
		const originalHost = process.env.BLOB_STORE_HOST;
		const originalContainer = process.env.BLOB_STORE_CONTAINER;
		delete process.env.BLOB_STORE_HOST;
		delete process.env.BLOB_STORE_CONTAINER;
		try {
			await assert.rejects(() => downloadBlobToTempFile('a.geojson'), /BLOB_STORE_HOST and BLOB_STORE_CONTAINER/);
		} finally {
			if (originalHost !== undefined) process.env.BLOB_STORE_HOST = originalHost;
			if (originalContainer !== undefined) process.env.BLOB_STORE_CONTAINER = originalContainer;
		}
	});
});
