/**
 * Compute a map centre and zoom that roughly fits a GeoJSON FeatureCollection.
 *
 * Sample case maps use a fixed, hand-picked centre per case
 * (`src/data/sample-map-polygons.ts`). `/uploads/map` shows whatever is
 * currently in the geometry database — arbitrary uploads with no
 * pre-defined centre — so it needs to derive one from the data itself.
 */

/** A `[longitude, latitude]` pair. */
export type LngLat = readonly [number, number];

/** Map centre and zoom for {@link file://./../public/javascripts/uploads-map.js}. */
export interface MapView {
	/** Map centre. */
	center: LngLat;
	/** Map zoom level. */
	zoom: number;
}

/** Fallback view when there is no geometry to fit (roughly England / Wales). */
const FALLBACK_MAP_VIEW: MapView = { center: [-2.5, 52.5], zoom: 6 };

const MIN_ZOOM = 2;
const MAX_ZOOM = 18;

/**
 * Recursively flatten a GeoJSON `coordinates` array into `[lng, lat]` pairs,
 * regardless of geometry nesting depth (Point through MultiPolygon).
 *
 * @param value - A `coordinates` array (or nested array) from any GeoJSON geometry
 * @param positions - Accumulator, appended to in place
 */
function collectPositionsFromCoordinates(value: unknown, positions: LngLat[]): void {
	if (!Array.isArray(value)) {
		return;
	}
	if (typeof value[0] === 'number' && typeof value[1] === 'number') {
		positions.push([value[0], value[1]]);
		return;
	}
	for (const item of value) {
		collectPositionsFromCoordinates(item, positions);
	}
}

/**
 * Collect every position referenced by one GeoJSON geometry, including
 * `GeometryCollection` members.
 *
 * @param geometry - A GeoJSON geometry
 * @param positions - Accumulator, appended to in place
 */
function collectPositionsFromGeometry(
	geometry: { type: string; coordinates?: unknown; geometries?: unknown },
	positions: LngLat[]
): void {
	if (geometry.type === 'GeometryCollection') {
		const members = Array.isArray(geometry.geometries) ? geometry.geometries : [];
		for (const member of members as {
			type: string;
			coordinates?: unknown;
			geometries?: unknown;
		}[]) {
			collectPositionsFromGeometry(member, positions);
		}
		return;
	}
	collectPositionsFromCoordinates(geometry.coordinates, positions);
}

/** A longitude/latitude bounding box. */
export interface Bounds {
	west: number;
	south: number;
	east: number;
	north: number;
}

type GeometryLike = { type: string; coordinates?: unknown; geometries?: unknown };

/**
 * Bounding box of every feature in a FeatureCollection, or `null` when there's no geometry. A loop
 * rather than `Math.min(...positions)`: real geometries run to hundreds of thousands of points,
 * which overflows the call stack as spread arguments.
 */
export function computeBounds(featureCollection: { features: { geometry: GeometryLike }[] }): Bounds | null {
	const positions: LngLat[] = [];
	for (const feature of featureCollection.features) {
		collectPositionsFromGeometry(feature.geometry, positions);
	}
	if (positions.length === 0) {
		return null;
	}
	const bounds: Bounds = {
		west: positions[0][0],
		south: positions[0][1],
		east: positions[0][0],
		north: positions[0][1]
	};
	for (const [longitude, latitude] of positions) {
		bounds.west = Math.min(bounds.west, longitude);
		bounds.east = Math.max(bounds.east, longitude);
		bounds.south = Math.min(bounds.south, latitude);
		bounds.north = Math.max(bounds.north, latitude);
	}
	return bounds;
}

/**
 * Compute a centre and zoom that fits every feature in a FeatureCollection.
 *
 * Not a precise "fit bounds" (the interactive map is not given a bounding
 * box API in this spike's UMD surface) — a simple bounding-box midpoint plus
 * a zoom level sized to the box's span, clamped to a sane range.
 *
 * @param featureCollection - Features to fit; an empty collection returns a
 *   fixed England / Wales fallback view
 * @returns Map centre and zoom
 */
export function computeMapView(featureCollection: { features: { geometry: GeometryLike }[] }): MapView {
	const bounds = computeBounds(featureCollection);
	if (!bounds) {
		return FALLBACK_MAP_VIEW;
	}

	const center: LngLat = [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2];

	// Pad the span slightly so edge features are not flush against the viewport.
	const span = Math.max(bounds.east - bounds.west, bounds.north - bounds.south, 0.001) * 1.3;
	const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.floor(Math.log2(360 / span))));

	return { center, zoom };
}
