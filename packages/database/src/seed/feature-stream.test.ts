import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { streamFeatures } from './feature-stream.ts';

async function streamed(contents: string) {
	const dir = await mkdtemp(path.join(tmpdir(), 'feature-stream-'));
	try {
		const filePath = path.join(dir, 'data.geojson');
		await writeFile(filePath, contents);
		const features = [];
		for await (const item of streamFeatures(filePath)) {
			features.push(item);
		}
		return features;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

const point = (id: string, extra: Record<string, unknown> = {}) => ({
	type: 'Feature',
	geometry: { type: 'Point', coordinates: [0, 0] },
	properties: { id, ...extra }
});

describe('streamFeatures', () => {
	test('yields each feature with its length, past the members around the array', async () => {
		const collection = {
			type: 'FeatureCollection',
			name: 'combined [reference] {data}',
			crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
			features: [point('a'), point('b')],
			bbox: [0, 0, 1, 1]
		};
		const features = await streamed(JSON.stringify(collection, null, 2));
		assert.deepEqual(
			features.map(({ feature }) => feature),
			collection.features
		);
		assert.equal(features[0].length, JSON.stringify(collection.features[0], null, 2).replace(/\n/g, '\n    ').length);
	});

	test('reads strings holding brackets, quotes, escapes and the word features as text', async () => {
		const tricky = point('a', {
			consultee: 'Albert "Dock" {East} [and] \\ West',
			features: ['not', 'the', 'top-level', 'array'],
			metadata: { NAME: 'Afon Ganol', features: { nested: true } }
		});
		const features = await streamed(JSON.stringify({ features: [tricky, point('b')], type: 'FeatureCollection' }));
		assert.deepEqual(
			features.map(({ feature }) => feature),
			[tricky, point('b')]
		);
	});

	test('reads a feature split across the chunks the file is read in', async () => {
		// the file is read a megabyte at a time - this feature spans several
		const large = point('large', { padding: 'x'.repeat(3 * 1024 * 1024), name: 'Ynys Môn' });
		const features = await streamed(
			JSON.stringify({ type: 'FeatureCollection', features: [point('a'), large, point('b')] })
		);
		assert.deepEqual(
			features.map(({ feature }) => (feature as { properties: { id: string } }).properties.id),
			['a', 'large', 'b']
		);
		assert.equal((features[1].feature as typeof large).properties.name, 'Ynys Môn');
		assert.equal(features[1].length, JSON.stringify(large).length);
	});

	test('yields nothing for an empty features array, and skips elements that are not features', async () => {
		assert.deepEqual(await streamed('{"type": "FeatureCollection", "features": []}'), []);
		const features = await streamed(`{"features": [1, "two", null, ${JSON.stringify(point('a'))}, [3]]}`);
		assert.deepEqual(
			features.map(({ feature }) => feature),
			[point('a'), [3]]
		);
	});

	for (const [title, contents, message] of [
		[
			'a file that ends partway',
			'{"type": "FeatureCollection", "features": [{"type": "Feature"',
			/ended before its GeoJSON was complete/
		],
		[
			'a file that ends inside a string',
			'{"type": "FeatureCollection", "name": "comb',
			/ended before its GeoJSON was complete/
		],
		['a document with no features array', '{"type": "Feature", "geometry": null}', /has no features array/],
		['a features member that is not an array', '{"features": {"0": {}}}', /has no features array/],
		['text that is not JSON', 'not json', /has no features array/]
	] as const) {
		test(`refuses ${title}`, async () => {
			await assert.rejects(() => streamed(contents), message);
		});
	}

	test('refuses a feature that is not valid JSON', async () => {
		await assert.rejects(() => streamed('{"features": [{"type": Feature}]}'), SyntaxError);
	});
});
