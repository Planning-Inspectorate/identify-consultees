import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import {
	categoryBufferMetres,
	formatBufferDistance,
	screenedSite,
	siteBufferGeojson,
	siteBuffers
} from './site-buffers.ts';

const RULESET: Ruleset = {
	id: 'test-ruleset',
	name: 'Test ruleset',
	rules: [
		{
			id: 'ambulance-near',
			name: 'Ambulance near',
			group: 'Public bodies',
			logicType: 'intersection',
			categories: ['Ambulance Trust'],
			bufferMetres: 1_000
		},
		{
			id: 'ambulance-and-hospital',
			name: 'Ambulance and hospital',
			group: 'Public bodies',
			logicType: 'intersection',
			categories: ['Ambulance Trust', 'Hospital'],
			bufferMetres: 10_000
		},
		{
			id: 'hospital-touching',
			name: 'Hospital touching',
			group: 'Public bodies',
			logicType: 'intersection',
			categories: ['Hospital'],
			bufferMetres: 0
		},
		{
			id: 'parish-host',
			name: 'Parish host',
			group: 'Administrative boundaries',
			logicType: 'intersection',
			categories: ['Parish Council']
		},
		{
			id: 'parish-bordering',
			name: 'Parish bordering',
			group: 'Administrative boundaries',
			logicType: 'bordering',
			categories: ['Parish Council'],
			hostCategory: 'Parish Council'
		}
	]
};

describe("a category's buffers", () => {
	it("are its conditions' distances, smallest first, each once - none for touching or bordering", () => {
		assert.deepStrictEqual(categoryBufferMetres(RULESET, 'Ambulance Trust', 5_000), [1_000, 10_000]);
		assert.deepStrictEqual(categoryBufferMetres(RULESET, 'Hospital', 5_000), [10_000]);
		assert.deepStrictEqual(categoryBufferMetres(RULESET, 'Parish Council', 5_000), []);
		assert.deepStrictEqual(categoryBufferMetres(RULESET, 'Railway', 5_000), []);
	});

	it('are the Nearby NSIPs distance for Nearby NSIPs, if it has one', () => {
		assert.deepStrictEqual(categoryBufferMetres(RULESET, 'NSIPs', 5_000), [5_000]);
		assert.deepStrictEqual(categoryBufferMetres(RULESET, 'NSIPs', 0), []);
	});

	it('read in metres under a kilometre, else kilometres', () => {
		assert.strictEqual(formatBufferDistance(500), '500 m');
		assert.strictEqual(formatBufferDistance(1_000), '1 km');
		assert.strictEqual(formatBufferDistance(1_500), '1.5 km');
		assert.strictEqual(formatBufferDistance(35_000), '35 km');
	});
});

const PROJECT: CaseBoundaryFeature = {
	type: 'Feature',
	id: '44444444-4444-4444-4444-444444444444',
	properties: { caseReference: 'EN010099', caseName: 'Real Test Project', fileName: 'site.geojson' },
	geometry: {
		type: 'Polygon',
		coordinates: [
			[
				[-1.6, 52.4],
				[-1.4, 52.4],
				[-1.4, 52.6],
				[-1.6, 52.6],
				[-1.6, 52.4]
			]
		]
	}
} as CaseBoundaryFeature;

describe('the site the buffers grow from', () => {
	it("is the site's outline, or the rectangle around it grown by 1km, as the function screens it", () => {
		assert.strictEqual(screenedSite(PROJECT, 'outline'), PROJECT.geometry);
		// the outline simplified to 10m, as the run sends it, where the row has one
		const simplifiedGeometry = { type: 'Point' as const, coordinates: [-1.5, 52.5] as [number, number] };
		assert.strictEqual(screenedSite({ ...PROJECT, simplifiedGeometry }, 'outline'), simplifiedGeometry);
		const box = screenedSite(PROJECT, 'boundingBox');
		assert.strictEqual(box.type, 'Polygon');
		const [ring] = (box as { coordinates: number[][][] }).coordinates;
		const latitudeMargin = 1_000 / 111_320;
		const longitudeMargin = 1_000 / (111_320 * Math.cos(((52.6 + latitudeMargin) * Math.PI) / 180));
		assert.deepStrictEqual(ring[0], [-1.6 - longitudeMargin, 52.4 - latitudeMargin]);
		assert.deepStrictEqual(ring[2], [-1.4 + longitudeMargin, 52.6 + latitudeMargin]);
		assert.deepStrictEqual(ring[4], ring[0]);
	});
});

describe("the site's buffers", () => {
	const square = (size: number) => ({
		type: 'Polygon' as const,
		coordinates: [
			[
				[-1.6, 52.4],
				[-1.6 + size, 52.4],
				[-1.6 + size, 52.4 + size],
				[-1.6, 52.4]
			]
		]
	});

	it('grows each distance once, sharing a cache - leaving out one that cannot be drawn', async () => {
		const queryRaw = mock.fn(async (_sql: unknown, ...values: unknown[]) => {
			if (values.includes(10_000)) {
				throw new Error('too big');
			}
			return [{ wkt: 'POLYGON((-1.7 52.3, -1.3 52.3, -1.3 52.7, -1.7 52.3))' }];
		});
		const logger = mockLogger();
		const service = { db: { $queryRaw: queryRaw }, logger } as never;
		const cache = new Map();
		const buffers = await siteBuffers(service, PROJECT, 'outline', [2_000, 10_000], cache);
		assert.deepStrictEqual(
			buffers.map(({ metres }) => metres),
			[2_000]
		);
		assert.equal(logger.warn.mock.callCount(), 1);
		// a second map of the same report draws them again from the cache
		await siteBuffers(service, PROJECT, 'outline', [2_000, 10_000], cache);
		assert.equal(queryRaw.mock.callCount(), 2);
	});

	it('are a feature each, labelled with its distance', () => {
		assert.deepStrictEqual(
			siteBufferGeojson([
				{ metres: 500, geometry: square(0.1) },
				{ metres: 10_000, geometry: square(0.2) }
			]),
			{
				type: 'FeatureCollection',
				features: [
					{ type: 'Feature', properties: { label: '500 m' }, geometry: square(0.1) },
					{ type: 'Feature', properties: { label: '10 km' }, geometry: square(0.2) }
				]
			}
		);
	});
});
