/**
 * Build the GeoJSON (and derived map view) for a case's ruleset results page: the project's own
 * boundary, plus every consultee area a ruleset matched - the same two layers the interactive map
 * and its static-map fallback both render.
 */

import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { ConsulteeAreaMatch } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import { computeMapView } from './geometry-bounds.ts';
import type { GeoJsonFeatureCollection } from './sample-geojson.ts';
import { MAP_VIEWPORT } from './sample-geojson.ts';

export function buildProjectGeojson(project: CaseBoundaryFeature): GeoJsonFeatureCollection {
	return {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				id: project.id,
				properties: {
					name: project.properties.caseName,
					reference: project.properties.caseReference,
					layer: 'project-site'
				},
				geometry: project.geometry
			}
		]
	};
}

// A ruleset is now the union of every condition it's made of (see geospatial/rulesets.ts), so a
// single run can realistically return thousands of matches (e.g. most parish councils near a
// large site). Rendering that many complex polygons - in the client-side interactive map, and
// especially in the server-side static-map SVG/PNG fallback - is slow enough to be a real
// reliability risk, not just a cosmetic one. Above MAP_SAMPLING_THRESHOLD matches, the map shows
// only a sample; the results table (built from the full, unsampled list) is unaffected.
export const MAP_SAMPLING_THRESHOLD = 50;
export const MAX_SAMPLED_MAP_MATCHES = 30;

export function buildConsulteeMatchesGeojson(matches: ConsulteeAreaMatch[]): GeoJsonFeatureCollection {
	const sample = matches.length > MAP_SAMPLING_THRESHOLD ? matches.slice(0, MAX_SAMPLED_MAP_MATCHES) : matches;
	return {
		type: 'FeatureCollection',
		features: sample.map((match) => ({
			type: 'Feature',
			id: match.feature.id,
			properties: {
				name: match.feature.properties.consultee ?? '',
				consulteeCategory: match.feature.properties.consulteeCategory ?? '',
				region: match.feature.properties.region ?? '',
				distanceMetres: String(Math.round(match.distanceMetres))
			},
			geometry: match.feature.geometry
		}))
	};
}

export interface CaseMapConfig {
	center: readonly [number, number];
	zoom: number;
	width: number;
	height: number;
	mapLabel: string;
	projectLayerLabel: string;
	consulteeLayerLabel: string;
	projectGeojson: GeoJsonFeatureCollection;
	consulteeGeojson: GeoJsonFeatureCollection;
	/** Total matches the ruleset found - may be larger than consulteeGeojson.features.length. */
	matchCount: number;
	/** True when the map shows a sample rather than every match - see MAP_SAMPLING_THRESHOLD. */
	isSampled: boolean;
}

export function buildCaseMapConfig(
	project: CaseBoundaryFeature,
	matches: ConsulteeAreaMatch[],
	rulesetName: string
): CaseMapConfig {
	const projectGeojson = buildProjectGeojson(project);
	const consulteeGeojson = buildConsulteeMatchesGeojson(matches);
	const view = computeMapView({ features: [...projectGeojson.features, ...consulteeGeojson.features] });
	const mapLabel = `${rulesetName} for ${project.properties.caseName} (${project.properties.caseReference})`;

	return {
		center: view.center,
		zoom: view.zoom,
		width: MAP_VIEWPORT.width,
		height: MAP_VIEWPORT.height,
		mapLabel,
		projectLayerLabel: `Project site (${project.properties.caseReference})`,
		consulteeLayerLabel: rulesetName,
		projectGeojson,
		consulteeGeojson,
		matchCount: matches.length,
		isSampled: matches.length > MAP_SAMPLING_THRESHOLD
	};
}
