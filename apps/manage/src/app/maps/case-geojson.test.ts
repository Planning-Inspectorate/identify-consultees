import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { ConsulteeMatch } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { Geometry } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { REPORT_CONFIG } from '../report-config.ts';
import {
	buildCaseMapConfig,
	buildProjectGeojson,
	LOCAL_FILL_OPACITY,
	markAddedByHand,
	NEARBY_LOCAL_FILL_OPACITY,
	NEARBY_REGIONAL_FILL_OPACITY,
	REGIONAL_FILL_OPACITY
} from './case-geojson.ts';
import { computeFittedMapView } from './geometry-bounds.ts';
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

describe('buildCaseMapConfig', () => {
	it('draws every match that has geometry, without a search area', () => {
		const matches = Array.from({ length: 60 }, (_, i) => match(`${i}`));
		const config = buildCaseMapConfig(project(), matches, 'England Wales post 30 April 2024');
		assert.strictEqual(config.consulteeGeojson.features.length, 60);
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

	it('opens on the site, not the search area, with matches in their display geometry', () => {
		const config = buildCaseMapConfig(
			project(),
			[match('inside'), match('outside')],
			'England Wales post 30 April 2024',
			{
				area,
				geometries: new Map([['inside', display]])
			}
		);

		// the point site at the middle, with config/report.yaml's default distance around it
		assert.deepStrictEqual(config.center, [-1.5, 52.5]);
		assert.strictEqual(
			config.zoom,
			computeFittedMapView(buildProjectGeojson(project()), MAP_VIEWPORT, REPORT_CONFIG.defaults.mapMarginMetres).zoom
		);
		// a category's own distance, when its map is given one
		const closer = buildCaseMapConfig(project(), [], 'Parish Council', undefined, undefined, 500);
		assert.strictEqual(closer.zoom, computeFittedMapView(buildProjectGeojson(project()), MAP_VIEWPORT, 500).zoom);
		assert.ok(closer.zoom > config.zoom);
		// only the match touching the area is drawn, in its display geometry
		assert.deepStrictEqual(
			config.consulteeGeojson.features.map((feature) => [feature.id, feature.geometry]),
			[['inside', { type: 'Point', coordinates: [1.12346, 52.12346] }]]
		);
		assert.strictEqual('searchAreaGeojson' in config, false);
		assert.strictEqual('nearbyGeojson' in config, false);
	});

	it('draws every match, coloured by category', () => {
		const matches = Array.from({ length: 60 }, (_, i) => match(`${i}`));
		const config = buildCaseMapConfig(project(), matches, 'England Wales post 30 April 2024', {
			area,
			geometries: new Map(matches.map((m) => [m.feature.id, display] as const))
		});

		assert.strictEqual(config.consulteeGeojson.features.length, 60);
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

	it('draws a nearby consultee a user added by hand as identified, leaving the others faint', () => {
		const nearby = (id: string): ConsulteeMatch => ({
			...match(id),
			reasons: [{ type: 'nearby', radiusMetres: 20000 }]
		});
		const matches = [nearby('picked'), nearby('not-picked')];
		// nothing picked - the matches as they are
		assert.strictEqual(markAddedByHand(matches, new Set()), matches);
		const config = buildCaseMapConfig(project(), markAddedByHand(matches, new Set(['picked'])), 'Railway', {
			area,
			geometries: new Map<string, Geometry>([
				['picked', display],
				['not-picked', display]
			])
		});

		assert.deepStrictEqual(
			config.consulteeGeojson.features.map((feature) => [
				feature.id,
				feature.properties.identified,
				feature.properties.fillOpacity
			]),
			[
				['not-picked', 'false', String(NEARBY_LOCAL_FILL_OPACITY)],
				['picked', 'true', String(LOCAL_FILL_OPACITY)]
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
