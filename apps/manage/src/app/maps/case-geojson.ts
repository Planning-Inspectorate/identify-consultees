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

export function buildConsulteeMatchesGeojson(matches: ConsulteeAreaMatch[]): GeoJsonFeatureCollection {
	return {
		type: 'FeatureCollection',
		features: matches.map((match) => ({
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
		consulteeGeojson
	};
}
