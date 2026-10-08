/**
 * Build the GeoJSON (and derived map view) for a case's ruleset results page: the project's own
 * boundary, plus every consultee a ruleset run found - the same two layers the interactive map
 * and its static-map fallback both render.
 */

import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { ConsulteeMatch } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { Geometry } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';
import { assignCategoryColours, colourFor, UNCATEGORISED } from './category-colours.ts';
import { computeBounds, computeMapView } from './geometry-bounds.ts';
import type { GeoJsonFeature, GeoJsonFeatureCollection } from './sample-geojson.ts';
import { MAP_VIEWPORT } from './sample-geojson.ts';

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
				geometry: roundGeometry(project.geometry)
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
// Display geometry, simplified by size, is small enough to draw every match.
export const MAP_SAMPLING_THRESHOLD = 50;
export const MAX_SAMPLED_MAP_MATCHES = 30;

function categoryOf(match: Pick<ConsulteeMatch, 'feature'>): string {
	return match.feature.properties.consulteeCategory || UNCATEGORISED;
}

type DrawableMatch = ConsulteeMatch & { feature: { geometry: Geometry } };

function isDrawable(match: ConsulteeMatch): match is DrawableMatch {
	return match.feature.geometry !== undefined;
}

/**
 * The consultees that have geometry to draw - consultees found only by the nearby search come
 * without original geometry, so they're drawn only from display geometry (see buildCaseMapConfig).
 */
export function buildConsulteeMatchesGeojson(
	matches: ConsulteeMatch[],
	colours: Map<string, string> = assignCategoryColours(matches.map(categoryOf)),
	sample = true
): GeoJsonFeatureCollection {
	const drawable = matches.filter(isDrawable);
	const drawn =
		sample && drawable.length > MAP_SAMPLING_THRESHOLD ? drawable.slice(0, MAX_SAMPLED_MAP_MATCHES) : drawable;
	return {
		type: 'FeatureCollection',
		features: drawn.map((match) => ({
			type: 'Feature',
			id: match.feature.id,
			properties: {
				// MapLibre drops string feature ids, so map selection needs the id as a property
				consulteeId: match.feature.id,
				name: match.feature.properties.consultee ?? '',
				consulteeCategory: categoryOf(match),
				region: match.feature.properties.region ?? '',
				colour: colourFor(colours, categoryOf(match))
			},
			geometry: match.feature.geometry
		}))
	};
}

/**
 * A site's search area - the site grown by the nearby radius - and the matched consultee areas
 * touching it. When given, the map opens on the search area, which isn't drawn: framing on whole
 * regional areas (counties, ambulance trusts) would zoom out so far the site is lost.
 */
export interface SearchAreaDisplay {
	/** The site grown by the nearby radius. */
	area: Geometry;
	/** Whole display geometry of the ruleset's matches touching `area`, by consultee area id. */
	geometries: Map<string, Geometry>;
}

/** Where the JS fallback's static-map image lives when the interactive map can't start. */
export interface StaticMapFallbackConfig {
	src: string;
	alt: string;
	width: number;
	height: number;
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
	/** True when the map shows a sample rather than every match - see MAP_SAMPLING_THRESHOLD. Never with a search area. */
	isSampled: boolean;
	/**
	 * The JS init-failure fallback's static-map image - carried in the page config because
	 * data-* attributes on the map container are JSON.parsed by the InteractiveMap constructor.
	 */
	fallback?: StaticMapFallbackConfig;
}

// regional areas (police force, ambulance trust, county) cover most of the search area, and a dozen
// of them stacked at a local area's opacity bury everything - they're only tinted, and drawn under
// the local ones
export const LOCAL_FILL_OPACITY = 0.35;
export const REGIONAL_FILL_OPACITY = 0.06;
const REGIONAL_COVERAGE = 0.5;

function boundingBoxArea(features: GeoJsonFeature[]): number {
	const bounds = computeBounds({ features });
	return bounds ? (bounds.east - bounds.west) * (bounds.north - bounds.south) : 0;
}

/**
 * Each match's fill opacity (`fillOpacity`), by category: regional if any area in the category
 * covers most of the search area's bounding box, and regional ones first. Without a search area,
 * every category is local.
 */
function withFillOpacity(
	collection: GeoJsonFeatureCollection,
	searchArea?: GeoJsonFeature[]
): GeoJsonFeatureCollection {
	const regionalArea = searchArea ? boundingBoxArea(searchArea) * REGIONAL_COVERAGE : Infinity;
	const regional = new Set(
		collection.features
			.filter((feature) => boundingBoxArea([feature]) >= regionalArea)
			.map((feature) => feature.properties.consulteeCategory)
	);
	const isRegional = (feature: GeoJsonFeature) => regional.has(feature.properties.consulteeCategory);
	return {
		...collection,
		// the static map draws in feature order
		features: [...collection.features.filter(isRegional), ...collection.features.filter((f) => !isRegional(f))].map(
			(feature) => ({
				...feature,
				properties: {
					...feature.properties,
					fillOpacity: String(isRegional(feature) ? REGIONAL_FILL_OPACITY : LOCAL_FILL_OPACITY)
				}
			})
		)
	};
}

/** `matches` with their display geometry from `geometries`; any with none (not touching the area) are left out. */
function withDisplayGeometry(matches: ConsulteeMatch[], geometries: Map<string, Geometry>): ConsulteeMatch[] {
	return matches.flatMap((match) => {
		const geometry = geometries.get(match.feature.id);
		return geometry ? [{ ...match, feature: { ...match.feature, geometry: roundGeometry(geometry) } }] : [];
	});
}

export function buildCaseMapConfig(
	project: CaseBoundaryFeature,
	matches: ConsulteeMatch[],
	rulesetName: string,
	searchArea?: SearchAreaDisplay,
	fallback?: { src: string; alt: string }
): CaseMapConfig {
	const projectGeojson = buildProjectGeojson(project);
	const colours = assignCategoryColours(matches.map(categoryOf));
	const searchAreaFeatures: GeoJsonFeature[] | undefined = searchArea && [
		{ type: 'Feature', properties: {}, geometry: searchArea.area }
	];
	const consulteeGeojson = withFillOpacity(
		searchArea
			? buildConsulteeMatchesGeojson(withDisplayGeometry(matches, searchArea.geometries), colours, false)
			: buildConsulteeMatchesGeojson(matches, colours),
		searchAreaFeatures
	);
	const view = computeMapView({
		features: searchAreaFeatures ?? [...projectGeojson.features, ...consulteeGeojson.features]
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
		isSampled: !searchArea && matches.length > MAP_SAMPLING_THRESHOLD,
		...(fallback ? { fallback: { ...fallback, width: MAP_VIEWPORT.width, height: MAP_VIEWPORT.height } } : {})
	};
}
