import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { ConsulteeMatch } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { Geometry } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';
import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
	buildCaseMapConfig,
	buildConsulteeMatchesGeojson,
	LOCAL_FILL_OPACITY,
	MAP_SAMPLING_THRESHOLD,
	MAX_SAMPLED_MAP_MATCHES,
	NEARBY_LOCAL_FILL_OPACITY,
	NEARBY_REGIONAL_FILL_OPACITY,
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

function match(id: string): ConsulteeMatch {
	return {
		feature: {
			id,
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [-1.5, 52.5] },
			properties: { consultee: 'Network Rail', consulteeCategory: 'Railway', region: 'Midlands' }
		},
		distanceMetres: 0,
		reasons: [{ type: 'condition', conditionId: 'railways_10km' }]
	} as ConsulteeMatch;
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
		const config = buildCaseMapConfig(project(), matches, 'England Wales post 30 April 2024');
		assert.strictEqual(config.matchCount, 1);
		assert.strictEqual(config.isSampled, false);
		assert.strictEqual(config.consulteeGeojson.features.length, 1);
	});

	it('reports the full match count and isSampled true, with a sampled map, once over the threshold', () => {
		const matches = Array.from({ length: MAP_SAMPLING_THRESHOLD + 1 }, (_, i) => match(`${i}`));
		const config = buildCaseMapConfig(project(), matches, 'England Wales post 30 April 2024');
		assert.strictEqual(config.matchCount, MAP_SAMPLING_THRESHOLD + 1);
		assert.strictEqual(config.isSampled, true);
		assert.strictEqual(config.consulteeGeojson.features.length, MAX_SAMPLED_MAP_MATCHES);
	});

	it('carries the static-map fallback in the page config when given one', () => {
		const withFallback = buildCaseMapConfig(project(), [], 'England Wales post 30 April 2024', undefined, {
			src: '/consultees/x/results/static-map',
			alt: 'Static map'
		});
		assert.deepEqual(withFallback.fallback, {
			src: '/consultees/x/results/static-map',
			alt: 'Static map',
			width: MAP_VIEWPORT.width,
			height: MAP_VIEWPORT.height
		});

		const without = buildCaseMapConfig(project(), [], 'England Wales post 30 April 2024');
		assert.strictEqual(without.fallback, undefined);
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

	it('opens on the search area without drawing it, with matches in their display geometry', () => {
		const config = buildCaseMapConfig(
			project(),
			[match('inside'), match('outside')],
			'England Wales post 30 April 2024',
			{
				area,
				geometries: new Map([['inside', display]])
			}
		);

		assert.deepStrictEqual(config.center, [1.15, 52.1]);
		// only the match touching the area is drawn, in its display geometry - but the count is every match
		assert.deepStrictEqual(
			config.consulteeGeojson.features.map((feature) => [feature.id, feature.geometry]),
			[['inside', { type: 'Point', coordinates: [1.12346, 52.12346] }]]
		);
		assert.strictEqual(config.matchCount, 2);
		assert.strictEqual('searchAreaGeojson' in config, false);
		assert.strictEqual('nearbyGeojson' in config, false);
	});

	it('draws every match, coloured by category', () => {
		const matches = Array.from({ length: MAP_SAMPLING_THRESHOLD + 1 }, (_, i) => match(`${i}`));
		const config = buildCaseMapConfig(project(), matches, 'England Wales post 30 April 2024', {
			area,
			geometries: new Map(matches.map((m) => [m.feature.id, display] as const))
		});

		assert.strictEqual(config.isSampled, false);
		assert.strictEqual(config.consulteeGeojson.features.length, MAP_SAMPLING_THRESHOLD + 1);
		assert.strictEqual(config.consulteeGeojson.features[0].properties.colour, '#1d70b8');
	});

	it('tints categories with an area covering most of the search area, and draws them first', () => {
		const regionalMatch = {
			feature: {
				id: 'county',
				type: 'Feature',
				geometry: area,
				properties: { consultee: 'Suffolk', consulteeCategory: 'Upper Tier Authority' }
			},
			distanceMetres: 0,
			reasons: [{ type: 'condition', conditionId: 'c_host_county_councils_upper_tier_authorities' }]
		} as ConsulteeMatch;
		const empty = { type: 'GeometryCollection' as const, geometries: [] };
		const config = buildCaseMapConfig(
			project(),
			[match('parish'), regionalMatch, match('empty')],
			'England Wales post 30 April 2024',
			{
				area,
				geometries: new Map<string, Geometry>([
					['parish', display],
					['county', area],
					['empty', empty]
				])
			}
		);

		assert.deepStrictEqual(
			config.consulteeGeojson.features.map((feature) => [feature.id, feature.properties.fillOpacity]),
			[
				['county', String(REGIONAL_FILL_OPACITY)],
				['parish', String(LOCAL_FILL_OPACITY)],
				['empty', String(LOCAL_FILL_OPACITY)]
			]
		);
	});

	it('marks consultees only the nearby search found, fainter, and draws them under the identified ones', () => {
		const nearby = (base: ConsulteeMatch, id: string): ConsulteeMatch => ({
			...base,
			feature: { ...base.feature, id },
			reasons: [{ type: 'nearby', radiusMetres: 20000 }]
		});
		const regionalMatch = {
			...match('county'),
			feature: { ...match('county').feature, geometry: area, properties: { consulteeCategory: 'Upper Tier Authority' } }
		} as ConsulteeMatch;
		const config = buildCaseMapConfig(
			project(),
			[match('parish'), nearby(match('x'), 'nearby-parish'), regionalMatch, nearby(regionalMatch, 'nearby-county')],
			'England Wales post 30 April 2024',
			{
				area,
				geometries: new Map<string, Geometry>([
					['parish', display],
					['nearby-parish', display],
					['county', area],
					['nearby-county', area]
				])
			}
		);

		assert.deepStrictEqual(
			config.consulteeGeojson.features.map((feature) => [
				feature.id,
				feature.properties.identified,
				feature.properties.fillOpacity
			]),
			[
				['nearby-county', 'false', String(NEARBY_REGIONAL_FILL_OPACITY)],
				['county', 'true', String(REGIONAL_FILL_OPACITY)],
				['nearby-parish', 'false', String(NEARBY_LOCAL_FILL_OPACITY)],
				['parish', 'true', String(LOCAL_FILL_OPACITY)]
			]
		);
	});

	it('fills every match as local without a search area', () => {
		const config = buildCaseMapConfig(project(), [match('a')], 'England Wales post 30 April 2024');
		assert.strictEqual(config.consulteeGeojson.features[0].properties.fillOpacity, String(LOCAL_FILL_OPACITY));
	});

	it('rounds the project boundary to ~1m', () => {
		const detailed = {
			...project(),
			geometry: { type: 'Point' as const, coordinates: [-1.123456789, 52.987654321] as [number, number] }
		};
		const config = buildCaseMapConfig(detailed, [], 'England Wales post 30 April 2024');
		assert.deepStrictEqual(config.projectGeojson.features[0].geometry, {
			type: 'Point',
			coordinates: [-1.12346, 52.98765]
		});
	});

	it('draws matches in their stored geometry, with no nearby layer, without a search area', () => {
		const config = buildCaseMapConfig(project(), [match('a')], 'England Wales post 30 April 2024');
		assert.strictEqual('nearbyGeojson' in config, false);
		assert.deepStrictEqual(config.consulteeGeojson.features[0].geometry, match('a').feature.geometry);
	});
});
