/**
 * GeoJSON <-> WKT conversion, for talking to SQL Server's GEOGRAPHY type (which has no built-in
 * GeoJSON parser - geometry must reach `geography::STGeomFromText(wkt, 4326)` as WKT).
 */

export type Position = [number, number];

export interface PointGeometry {
	type: 'Point';
	coordinates: Position;
}

export interface MultiPointGeometry {
	type: 'MultiPoint';
	coordinates: Position[];
}

export interface LineStringGeometry {
	type: 'LineString';
	coordinates: Position[];
}

export interface MultiLineStringGeometry {
	type: 'MultiLineString';
	coordinates: Position[][];
}

export interface PolygonGeometry {
	type: 'Polygon';
	coordinates: Position[][];
}

export interface MultiPolygonGeometry {
	type: 'MultiPolygon';
	coordinates: Position[][][];
}

export interface GeometryCollectionGeometry {
	type: 'GeometryCollection';
	geometries: Geometry[];
}

export type Geometry =
	| PointGeometry
	| MultiPointGeometry
	| LineStringGeometry
	| MultiLineStringGeometry
	| PolygonGeometry
	| MultiPolygonGeometry
	| GeometryCollectionGeometry;

function formatPosition([lon, lat]: Position): string {
	return `${lon} ${lat}`;
}

function formatPositions(positions: Position[]): string {
	return positions.map(formatPosition).join(', ');
}

/**
 * Shoelace formula for a ring's signed area - positive means counter-clockwise.
 */
function signedRingArea(ring: Position[]): number {
	let total = 0;
	for (let i = 0; i < ring.length - 1; i++) {
		const [lon, lat] = ring[i];
		const [nextLon, nextLat] = ring[i + 1];
		total += lon * nextLat - nextLon * lat;
	}
	return total / 2;
}

/**
 * Reverse `ring` if needed so it winds the requested direction.
 *
 * SQL Server's geography type requires exterior rings counter-clockwise and holes clockwise, and
 * does not reliably reject a backwards ring - it can silently treat it as its geometric
 * complement (for a small polygon: "the whole globe except this shape"), which then matches every
 * proximity/intersects query downstream. Real-world GeoJSON (e.g. from shapefile conversions)
 * often doesn't follow GeoJSON's own winding recommendation, so winding is corrected
 * unconditionally here rather than trusting the source.
 */
function orientedRing(ring: Position[], clockwise: boolean): Position[] {
	const isClockwise = signedRingArea(ring) < 0;
	return isClockwise !== clockwise ? [...ring].reverse() : ring;
}

function formatPolygonRings(rings: Position[][]): string {
	// index 0 = exterior (counter-clockwise), index > 0 = holes (clockwise)
	const oriented = rings.map((ring, index) => orientedRing(ring, index > 0));
	return oriented.map((ring) => `(${formatPositions(ring)})`).join(', ');
}

/**
 * Convert a GeoJSON geometry to WKT for `geography::STGeomFromText(wkt, 4326)`.
 */
export function geometryToWkt(geometry: Geometry): string {
	switch (geometry.type) {
		case 'Point':
			return `POINT(${formatPosition(geometry.coordinates)})`;
		case 'MultiPoint':
			return `MULTIPOINT(${geometry.coordinates.map((position) => `(${formatPosition(position)})`).join(', ')})`;
		case 'LineString':
			return `LINESTRING(${formatPositions(geometry.coordinates)})`;
		case 'MultiLineString':
			return `MULTILINESTRING(${geometry.coordinates.map((line) => `(${formatPositions(line)})`).join(', ')})`;
		case 'Polygon':
			return `POLYGON(${formatPolygonRings(geometry.coordinates)})`;
		case 'MultiPolygon':
			return `MULTIPOLYGON(${geometry.coordinates.map((polygon) => `(${formatPolygonRings(polygon)})`).join(', ')})`;
		case 'GeometryCollection':
			return `GEOMETRYCOLLECTION(${geometry.geometries.map(geometryToWkt).join(', ')})`;
	}
}

function parseCoordinatePairs(text: string): Position[] {
	return text
		.split(',')
		.map((pair) => pair.trim())
		.filter(Boolean)
		.map((pair) => {
			const [lon, lat] = pair.split(/\s+/).map(Number);
			return [lon, lat] as Position;
		});
}

/**
 * Split `text` into the contents of its top-level, comma-separated, parenthesised groups (or
 * comma-separated items, if `parenthesised` is false), ignoring commas/parens nested inside them.
 * Used to pull apart e.g. a MULTIPOLYGON's per-polygon groups, or a GEOMETRYCOLLECTION's
 * per-geometry items.
 */
function splitTopLevel(text: string, parenthesised: boolean): string[] {
	const items: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === '(') {
			if (parenthesised && depth === 0) start = i + 1;
			depth++;
		} else if (char === ')') {
			depth--;
			if (parenthesised && depth === 0) items.push(text.slice(start, i));
		} else if (char === ',' && depth === 0 && !parenthesised) {
			items.push(text.slice(start, i));
			start = i + 1;
		}
	}
	if (!parenthesised) items.push(text.slice(start));
	return items.map((item) => item.trim()).filter(Boolean);
}

/**
 * Convert WKT (e.g. from `geometry.STAsText()`) back to a GeoJSON geometry.
 */
export function wktToGeometry(wkt: string): Geometry {
	const match = wkt.trim().match(/^([A-Z]+)\s*\((.*)\)$/s);
	if (!match) {
		throw new Error(`Unrecognised WKT: ${wkt}`);
	}
	const [, type, body] = match;
	switch (type) {
		case 'POINT':
			return { type: 'Point', coordinates: parseCoordinatePairs(body)[0] };
		case 'MULTIPOINT': {
			// MULTIPOINT may be written as MULTIPOINT(1 2, 3 4) or MULTIPOINT((1 2), (3 4))
			const groups = splitTopLevel(body, true);
			const coordinates =
				groups.length > 0 ? groups.map((group) => parseCoordinatePairs(group)[0]) : parseCoordinatePairs(body);
			return { type: 'MultiPoint', coordinates };
		}
		case 'LINESTRING':
			return { type: 'LineString', coordinates: parseCoordinatePairs(body) };
		case 'MULTILINESTRING':
			return { type: 'MultiLineString', coordinates: splitTopLevel(body, true).map(parseCoordinatePairs) };
		case 'POLYGON':
			return { type: 'Polygon', coordinates: splitTopLevel(body, true).map(parseCoordinatePairs) };
		case 'MULTIPOLYGON':
			return {
				type: 'MultiPolygon',
				coordinates: splitTopLevel(body, true).map((polygon) => splitTopLevel(polygon, true).map(parseCoordinatePairs))
			};
		case 'GEOMETRYCOLLECTION':
			return { type: 'GeometryCollection', geometries: splitTopLevel(body, false).map(wktToGeometry) };
		default:
			throw new Error(`Unsupported WKT type: ${type}`);
	}
}
