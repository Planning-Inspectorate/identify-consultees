import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import type { BufferMapStyles } from '../../maps/buffer-map-styles.ts';
import { assignBufferStyles, categoryBufferMetres, formatBufferDistance, screenedSite } from './site-buffers.ts';

import type { SiteBuffer } from './site-buffers.ts';

import { siteBufferGeojson, siteBuffers } from './site-buffers.ts';

const RULESET: Ruleset = {
	id: 'test-ruleset',
	name: 'Test ruleset',
	rules: [
		{
			id: 'ambulance-near',
			name: 'Ambulance near',
			group: 'Public bodies',
			logicType: 'intersection',
			categories: ['Ambulance trusts'],
			bufferMetres: 1_000
		},
		{
			id: 'ambulance-and-hospital',
			name: 'Ambulance and hospital',
			group: 'Public bodies',
			logicType: 'intersection',
			categories: ['Ambulance trusts', 'Hospitals operated by NHS trusts and NHS foundation trusts (England)'],
			bufferMetres: 10_000
		},
		{
			id: 'hospital-touching',
			name: 'Hospital touching',
			group: 'Public bodies',
			logicType: 'intersection',
			categories: ['Hospitals operated by NHS trusts and NHS foundation trusts (England)'],
			bufferMetres: 0
		},
		{
			id: 'parish-host',
			name: 'Parish host',
			group: 'Administrative boundaries',
			logicType: 'intersection',
			categories: ['Parish, town and community councils']
		},
		{
			id: 'parish-bordering',
			name: 'Parish bordering',
			group: 'Administrative boundaries',
			logicType: 'bordering',
			categories: ['Parish, town and community councils'],
			hostCategory: 'Parish, town and community councils'
		}
	]
};

describe("a category's buffers", () => {
	it("are its conditions' distances, smallest first, each once - none for touching or bordering", () => {
		assert.deepStrictEqual(categoryBufferMetres(RULESET, 'Ambulance trusts', 5_000), [1_000, 10_000]);
		assert.deepStrictEqual(
			categoryBufferMetres(RULESET, 'Hospitals operated by NHS trusts and NHS foundation trusts (England)', 5_000),
			[10_000]
		);
		assert.deepStrictEqual(categoryBufferMetres(RULESET, 'Parish, town and community councils', 5_000), []);
		assert.deepStrictEqual(categoryBufferMetres(RULESET, 'Railways', 5_000), []);
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
					{
						type: 'Feature',
						properties: {
							description: 'black, no fill, small border dashes, small border dashes gap',
							label: 'Ruleset buffer 500 m',
							metres: '500',
							stroke: '#0b0c0c',
							strokeDashArray: '[1,1]',
							strokeWidth: '2'
						},
						geometry: square(0.1)
					},
					{
						type: 'Feature',
						properties: {
							description: 'black, no fill, medium border dashes, medium border dashes gap',
							label: 'Ruleset buffer 10 km',
							metres: '10000',
							stroke: '#0b0c0c',
							strokeDashArray: '[3,3]',
							strokeWidth: '2'
						},
						geometry: square(0.2)
					}
				]
			}
		);
	});
});

const DUMMY_GEOMETRY = {
	type: 'Polygon' as const,
	coordinates: [
		[
			[-1.6, 52.4],
			[-1.4, 52.4],
			[-1.4, 52.6],
			[-1.6, 52.6],
			[-1.6, 52.4]
		]
	]
};

const buffer = (metres: number): SiteBuffer => ({
	metres,
	geometry: DUMMY_GEOMETRY,
	style: {
		stroke: '#000000',
		strokeWidth: 1,
		strokeDashArray: [1, 0],
		symbolDescription: ''
	}
});

const MAP_STYLES: BufferMapStyles = {
	buffers: [
		{
			colour: '#111111',
			strokeWidth: 1,
			strokeDash: [2, 2],
			description: '2 dash'
		},
		{
			colour: '#333333',
			strokeWidth: 3,
			strokeDash: [6, 6],
			description: '6 dash'
		},
		{
			colour: '#222222',
			strokeWidth: 2,
			strokeDash: [4, 4],
			description: '4 dash'
		}
	]
};

describe('assigning buffer styles', () => {
	it('maps each buffer to the style for its distance range, preserving input order', () => {
		const siteBuffers = [buffer(1), buffer(10_000), buffer(500), buffer(4_999), buffer(5_000), buffer(35_000)];

		// 2, 4 ,4, 6, 2, 6

		assert.deepStrictEqual(assignBufferStyles(siteBuffers, MAP_STYLES), [
			{
				stroke: '#111111',
				strokeDashArray: [2, 2],
				strokeWidth: 1,
				symbolDescription: '2 dash'
			},

			{
				stroke: '#333333',
				strokeWidth: 3,
				strokeDashArray: [6, 6],
				symbolDescription: '6 dash'
			},

			{
				stroke: '#333333',
				strokeWidth: 3,
				strokeDashArray: [6, 6],
				symbolDescription: '6 dash'
			},

			{
				stroke: '#222222',
				strokeWidth: 2,
				strokeDashArray: [4, 4],
				symbolDescription: '4 dash'
			},

			{
				stroke: '#111111',
				strokeWidth: 1,
				strokeDashArray: [2, 2],
				symbolDescription: '2 dash'
			},

			{
				stroke: '#222222',
				strokeWidth: 2,
				strokeDashArray: [4, 4],
				symbolDescription: '4 dash'
			}
		]);
	});
});
