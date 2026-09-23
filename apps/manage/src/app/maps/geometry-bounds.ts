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
export function computeMapView(featureCollection: {
	features: { geometry: { type: string; coordinates?: unknown; geometries?: unknown } }[];
}): MapView {
	const positions: LngLat[] = [];
	for (const feature of featureCollection.features) {
		collectPositionsFromGeometry(feature.geometry, positions);
	}

	if (positions.length === 0) {
		return FALLBACK_MAP_VIEW;
	}

	let minLongitude = positions[0][0];
	let maxLongitude = positions[0][0];
	let minLatitude = positions[0][1];
	let maxLatitude = positions[0][1];
	for (const [longitude, latitude] of positions) {
		minLongitude = Math.min(minLongitude, longitude);
		maxLongitude = Math.max(maxLongitude, longitude);
		minLatitude = Math.min(minLatitude, latitude);
		maxLatitude = Math.max(maxLatitude, latitude);
	}

	const center: LngLat = [(minLongitude + maxLongitude) / 2, (minLatitude + maxLatitude) / 2];

	// Pad the span slightly so edge features are not flush against the viewport.
	const span = Math.max(maxLongitude - minLongitude, maxLatitude - minLatitude, 0.001) * 1.3;
	const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.floor(Math.log2(360 / span))));

	return { center, zoom };
}
