/**
 * Build the GeoJSON (and derived map view) for a case's ruleset results page: the project's own
 * boundary, plus every consultee area a ruleset matched - the same two layers the interactive map
 * and its static-map fallback both render.
 */

import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type {
	ConsulteeAreaMatch,
	ConsulteeAreaSummaryMatch
} from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import type { Geometry } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';
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

// ~1m - plenty for drawing, and coordinates are most of the layer's size
const DISPLAY_COORDINATE_DECIMALS = 5;

type Coordinates = number | Coordinates[];

function roundCoordinates(value: Coordinates): Coordinates {
	return typeof value === 'number' ? Number(value.toFixed(DISPLAY_COORDINATE_DECIMALS)) : value.map(roundCoordinates);
}

function roundGeometry(geometry: Geometry): Geometry {
	if (geometry.type === 'GeometryCollection') {
		return { type: 'GeometryCollection', geometries: geometry.geometries.map(roundGeometry) };
	}
	return { ...geometry, coordinates: roundCoordinates(geometry.coordinates as Coordinates) } as Geometry;
}

/**
 * Every consultee area near the site, for the map's "all consultees nearby" layer. `geometries` is
 * display geometry (already clipped to the map's surroundings and simplified - see
 * getConsulteeAreaDisplayGeometries); an area without one is left off the map, though it's still
 * listed in the table.
 */
export function buildNearbyConsulteesGeojson(
	nearby: ConsulteeAreaSummaryMatch[],
	geometries: Map<string, Geometry>
): GeoJsonFeatureCollection {
	return {
		type: 'FeatureCollection',
		features: nearby.flatMap((match) => {
			const geometry = geometries.get(match.feature.id);
			if (!geometry) {
				return [];
			}
			return [
				{
					type: 'Feature' as const,
					id: match.feature.id,
					properties: {
						name: match.feature.properties.consultee ?? '',
						consulteeCategory: match.feature.properties.consulteeCategory ?? '',
						distanceMetres: String(Math.round(match.distanceMetres))
					},
					geometry: roundGeometry(geometry)
				}
			];
		})
	};
}

/**
 * The interactive map's view of a site's search area - the site grown by the nearby radius. When
 * given, the map opens on the search area and everything on it is clipped to it: regional areas
 * (counties, ambulance trusts) otherwise fill the view and hide everything near the site.
 */
export interface SearchAreaDisplay {
	/** The site grown by the nearby radius. */
	area: Geometry;
	areaLabel: string;
	nearbyLabel: string;
	nearby: ConsulteeAreaSummaryMatch[];
	/** Display geometry clipped to `area`, by consultee area id - nearby areas and the ruleset's matches. */
	geometries: Map<string, Geometry>;
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
	/** The search area outline, and every consultee inside it - interactive map only. */
	searchAreaLabel?: string;
	searchAreaGeojson?: GeoJsonFeatureCollection;
	nearbyLayerLabel?: string;
	nearbyGeojson?: GeoJsonFeatureCollection;
}

/** `matches` with their display geometry from `geometries`; any with none (outside the area) are left out. */
function withDisplayGeometry(matches: ConsulteeAreaMatch[], geometries: Map<string, Geometry>): ConsulteeAreaMatch[] {
	return matches.flatMap((match) => {
		const geometry = geometries.get(match.feature.id);
		return geometry ? [{ ...match, feature: { ...match.feature, geometry: roundGeometry(geometry) } }] : [];
	});
}

export function buildCaseMapConfig(
	project: CaseBoundaryFeature,
	matches: ConsulteeAreaMatch[],
	rulesetName: string,
	searchArea?: SearchAreaDisplay
): CaseMapConfig {
	const projectGeojson = buildProjectGeojson(project);
	const consulteeGeojson = buildConsulteeMatchesGeojson(
		searchArea ? withDisplayGeometry(matches, searchArea.geometries) : matches
	);
	const searchAreaGeojson: GeoJsonFeatureCollection | undefined = searchArea && {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				id: 'search-area',
				properties: { name: searchArea.areaLabel },
				geometry: roundGeometry(searchArea.area)
			}
		]
	};
	const view = computeMapView({
		features: searchAreaGeojson?.features ?? [...projectGeojson.features, ...consulteeGeojson.features]
	});
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
		isSampled: matches.length > MAP_SAMPLING_THRESHOLD,
		...(searchArea
			? {
					searchAreaLabel: searchArea.areaLabel,
					searchAreaGeojson,
					nearbyLayerLabel: searchArea.nearbyLabel,
					nearbyGeojson: buildNearbyConsulteesGeojson(searchArea.nearby, searchArea.geometries)
				}
			: {})
	};
}
