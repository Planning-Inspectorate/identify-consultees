import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { ConsulteeAreaMatch } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import type { Geometry } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';
import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
	buildCaseMapConfig,
	buildConsulteeMatchesGeojson,
	buildNearbyConsulteesGeojson,
	LOCAL_FILL_OPACITY,
	MAP_SAMPLING_THRESHOLD,
	MAX_SAMPLED_MAP_MATCHES,
	REGIONAL_FILL_OPACITY
} from './case-geojson.ts';
import { MAP_VIEWPORT } from './sample-geojson.ts';

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

	it('carries the static-map fallback in the page config when given one', () => {
		const withFallback = buildCaseMapConfig(project(), [], 'Example ruleset', undefined, {
			src: '/consultees/x/results/static-map',
			alt: 'Static map'
		});
		assert.deepEqual(withFallback.fallback, {
			src: '/consultees/x/results/static-map',
			alt: 'Static map',
			width: MAP_VIEWPORT.width,
			height: MAP_VIEWPORT.height
		});

		const without = buildCaseMapConfig(project(), [], 'Example ruleset');
		assert.strictEqual(without.fallback, undefined);
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
			properties: {
				consulteeId: 'a',
				name: 'Mid Suffolk',
				consulteeCategory: 'Lower Tier Authority',
				region: '',
				colour: '#1d70b8'
			},
			geometry: { type: 'Point', coordinates: [1.12346, 52.98765] }
		});
	});

	it('carries the region, for the map details panel', () => {
		const geojson = buildNearbyConsulteesGeojson(
			[nearby('a', { region: 'East of England' })],
			new Map([['a', { type: 'Point' as const, coordinates: [1, 52] as [number, number] }]])
		);
		assert.strictEqual(geojson.features[0].properties.region, 'East of England');
	});

	it('rounds geometry collections and defaults missing names and categories', () => {
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
		assert.deepStrictEqual(geojson.features[0].properties, {
			consulteeId: 'a',
			name: '',
			consulteeCategory: 'Other',
			region: '',
			colour: '#1d70b8'
		});
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
	const display = { type: 'Point' as const, coordinates: [1.1234567, 52.1234567] as [number, number] };

	it('opens on the search area without drawing it, with matches in their display geometry and the nearby layer', () => {
		const config = buildCaseMapConfig(project(), [match('inside'), match('outside')], 'Example ruleset', {
			area,
			nearbyLabel: 'All consultees within 20km',
			nearby: [{ feature: { id: 'inside', properties: { consultee: 'Mid Suffolk' } }, distanceMetres: 0 }],
			geometries: new Map([['inside', display]])
		});

		assert.deepStrictEqual(config.center, [1.15, 52.1]);
		// only the match touching the area is drawn, in its display geometry - but the count is every match
		assert.deepStrictEqual(
			config.consulteeGeojson.features.map((feature) => [feature.id, feature.geometry]),
			[['inside', { type: 'Point', coordinates: [1.12346, 52.12346] }]]
		);
		assert.strictEqual(config.matchCount, 2);
		assert.strictEqual('searchAreaGeojson' in config, false);
		assert.strictEqual(config.nearbyLayerLabel, 'All consultees within 20km');
		assert.strictEqual(config.nearbyGeojson?.features.length, 1);
	});

	it('draws every match, coloured by category the same way on both layers', () => {
		const matches = Array.from({ length: MAP_SAMPLING_THRESHOLD + 1 }, (_, i) => match(`${i}`));
		const config = buildCaseMapConfig(project(), matches, 'Example ruleset', {
			area,
			nearbyLabel: 'All consultees within 20km',
			nearby: [
				{
					feature: { id: 'h', properties: { consultee: 'A hospital', consulteeCategory: 'Hospital' } },
					distanceMetres: 0
				},
				{
					feature: { id: '0', properties: { consultee: 'Network Rail', consulteeCategory: 'Railway' } },
					distanceMetres: 0
				}
			],
			geometries: new Map([...matches.map((m) => [m.feature.id, display] as const), ['h', display]])
		});

		assert.strictEqual(config.isSampled, false);
		assert.strictEqual(config.consulteeGeojson.features.length, MAP_SAMPLING_THRESHOLD + 1);
		// the matches' category gets the first colour, even though Hospital sorts before it
		assert.strictEqual(config.consulteeGeojson.features[0].properties.colour, '#1d70b8');
		assert.deepStrictEqual(
			config.nearbyGeojson?.features.map((feature) => [
				feature.properties.consulteeCategory,
				feature.properties.colour
			]),
			[
				['Hospital', '#f47738'],
				['Railway', '#1d70b8']
			]
		);
	});

	it('tints categories with an area covering most of the search area, and draws them first', () => {
		const regionalMatch: ConsulteeAreaMatch = {
			feature: {
				id: 'county',
				type: 'Feature',
				geometry: area,
				properties: { consultee: 'Suffolk', consulteeCategory: 'Upper Tier Authority' }
			},
			distanceMetres: 0
		};
		const empty = { type: 'GeometryCollection' as const, geometries: [] };
		const config = buildCaseMapConfig(project(), [match('parish'), regionalMatch, match('empty')], 'Example ruleset', {
			area,
			nearbyLabel: 'All consultees within 20km',
			nearby: [],
			geometries: new Map<string, Geometry>([
				['parish', display],
				['county', area],
				['empty', empty]
			])
		});

		assert.deepStrictEqual(
			config.consulteeGeojson.features.map((feature) => [feature.id, feature.properties.fillOpacity]),
			[
				['county', String(REGIONAL_FILL_OPACITY)],
				['parish', String(LOCAL_FILL_OPACITY)],
				['empty', String(LOCAL_FILL_OPACITY)]
			]
		);
	});

	it('fills every match as local without a search area', () => {
		const config = buildCaseMapConfig(project(), [match('a')], 'Example ruleset');
		assert.strictEqual(config.consulteeGeojson.features[0].properties.fillOpacity, String(LOCAL_FILL_OPACITY));
	});

	it('rounds the project boundary to ~1m', () => {
		const detailed = {
			...project(),
			geometry: { type: 'Point' as const, coordinates: [-1.123456789, 52.987654321] as [number, number] }
		};
		const config = buildCaseMapConfig(detailed, [], 'Example ruleset');
		assert.deepStrictEqual(config.projectGeojson.features[0].geometry, {
			type: 'Point',
			coordinates: [-1.12346, 52.98765]
		});
	});

	it('draws matches in their stored geometry, with no nearby layer, without a search area', () => {
		const config = buildCaseMapConfig(project(), [match('a')], 'Example ruleset');
		assert.strictEqual('nearbyGeojson' in config, false);
		assert.deepStrictEqual(config.consulteeGeojson.features[0].geometry, match('a').feature.geometry);
	});
});
