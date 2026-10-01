import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { ConsulteeAreaMatch } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
	buildCaseMapConfig,
	buildConsulteeMatchesGeojson,
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
