import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { ConsulteeAreaMatch } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
	buildCaseMapConfig,
	buildConsulteeMatchesGeojson,
	buildNearbyConsulteesGeojson,
	MAP_SAMPLING_THRESHOLD,
	MAX_SAMPLED_MAP_MATCHES
} from './case-geojson.ts';

function project(): CaseBoundaryFeature {
	return {
		id: '44444444-4444-4444-4444-444444444444',
		type: 'Feature',
		geometry: { type: 'Point', coordinates: [-1.5, 52.5] },
		properties: { caseReference: 'EN010099', caseName: 'Real Test Project' }
	};
}

function match(id: string): ConsulteeAreaMatch {
	return {
		feature: {
			id,
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [-1.5, 52.5] },
			properties: { consultee: 'Network Rail', consulteeCategory: 'Railway', region: 'Midlands' }
		},
		distanceMetres: 0
	};
}

describe('buildConsulteeMatchesGeojson', () => {
	it('includes every match when at or below the sampling threshold', () => {
		const matches = Array.from({ length: MAP_SAMPLING_THRESHOLD }, (_, i) => match(`${i}`));
		const geojson = buildConsulteeMatchesGeojson(matches);
		assert.strictEqual(geojson.features.length, MAP_SAMPLING_THRESHOLD);
	});

	it('caps the map to a sample once matches exceed the sampling threshold', () => {
		const matches = Array.from({ length: MAP_SAMPLING_THRESHOLD + 1 }, (_, i) => match(`${i}`));
		const geojson = buildConsulteeMatchesGeojson(matches);
		assert.strictEqual(geojson.features.length, MAX_SAMPLED_MAP_MATCHES);
	});
});

describe('buildCaseMapConfig', () => {
	it('reports the full match count and isSampled false when under the threshold', () => {
		const matches = [match('1')];
		const config = buildCaseMapConfig(project(), matches, 'Example ruleset');
		assert.strictEqual(config.matchCount, 1);
		assert.strictEqual(config.isSampled, false);
		assert.strictEqual(config.consulteeGeojson.features.length, 1);
	});

	it('reports the full match count and isSampled true, with a sampled map, once over the threshold', () => {
		const matches = Array.from({ length: MAP_SAMPLING_THRESHOLD + 1 }, (_, i) => match(`${i}`));
		const config = buildCaseMapConfig(project(), matches, 'Example ruleset');
		assert.strictEqual(config.matchCount, MAP_SAMPLING_THRESHOLD + 1);
		assert.strictEqual(config.isSampled, true);
		assert.strictEqual(config.consulteeGeojson.features.length, MAX_SAMPLED_MAP_MATCHES);
	});
});

describe('buildNearbyConsulteesGeojson', () => {
	const nearby = (id: string, properties: Record<string, string | null> = {}) => ({
		feature: { id, properties: { consultee: 'Mid Suffolk', consulteeCategory: 'Lower Tier Authority', ...properties } },
		distanceMetres: 1234.6
	});

	it('includes each area that has display geometry, rounding coordinates to ~1m', () => {
		const geojson = buildNearbyConsulteesGeojson(
			[nearby('a'), nearby('b')],
			new Map([['a', { type: 'Point' as const, coordinates: [1.123456789, 52.987654321] as [number, number] }]])
		);
		assert.strictEqual(geojson.features.length, 1);
		assert.deepStrictEqual(geojson.features[0], {
			type: 'Feature',
			id: 'a',
			properties: { name: 'Mid Suffolk', consulteeCategory: 'Lower Tier Authority', distanceMetres: '1235' },
			geometry: { type: 'Point', coordinates: [1.12346, 52.98765] }
		});
	});

	it('rounds geometry collections and defaults missing names to empty strings', () => {
		const geojson = buildNearbyConsulteesGeojson(
			[nearby('a', { consultee: null, consulteeCategory: null })],
			new Map([
				[
					'a',
					{
						type: 'GeometryCollection' as const,
						geometries: [{ type: 'LineString' as const, coordinates: [[0.0000049, 1.0000051] as [number, number]] }]
					}
				]
			])
		);
		assert.deepStrictEqual(geojson.features[0].properties, { name: '', consulteeCategory: '', distanceMetres: '1235' });
		assert.deepStrictEqual(geojson.features[0].geometry, {
			type: 'GeometryCollection',
			geometries: [{ type: 'LineString', coordinates: [[0, 1.00001]] }]
		});
	});
});

describe('buildCaseMapConfig with a search area', () => {
	const area = {
		type: 'Polygon' as const,
		coordinates: [
			[
				[1, 52],
				[1.3, 52],
				[1.3, 52.2],
				[1, 52.2],
				[1, 52]
			]
		] as [number, number][][]
	};
	const clipped = { type: 'Point' as const, coordinates: [1.1234567, 52.1234567] as [number, number] };

	it('opens on the search area, with matches clipped to it and the nearby layer and outline added', () => {
		const config = buildCaseMapConfig(project(), [match('inside'), match('outside')], 'Example ruleset', {
			area,
			areaLabel: 'Search area (20km)',
			nearbyLabel: 'All consultees within 20km',
			nearby: [{ feature: { id: 'inside', properties: { consultee: 'Mid Suffolk' } }, distanceMetres: 0 }],
			geometries: new Map([['inside', clipped]])
		});

		assert.deepStrictEqual(config.center, [1.15, 52.1]);
		// only the match inside the area is drawn, with its clipped geometry - but the count is every match
		assert.deepStrictEqual(
			config.consulteeGeojson.features.map((feature) => [feature.id, feature.geometry]),
			[['inside', { type: 'Point', coordinates: [1.12346, 52.12346] }]]
		);
		assert.strictEqual(config.matchCount, 2);
		assert.strictEqual(config.searchAreaLabel, 'Search area (20km)');
		assert.strictEqual(config.searchAreaGeojson?.features[0].properties.name, 'Search area (20km)');
		assert.strictEqual(config.nearbyLayerLabel, 'All consultees within 20km');
		assert.strictEqual(config.nearbyGeojson?.features.length, 1);
	});

	it('leaves the search area out, and draws matches whole, without one', () => {
		const config = buildCaseMapConfig(project(), [match('a')], 'Example ruleset');
		assert.strictEqual('searchAreaGeojson' in config, false);
		assert.strictEqual('nearbyGeojson' in config, false);
		assert.deepStrictEqual(config.consulteeGeojson.features[0].geometry, match('a').feature.geometry);
	});
});
