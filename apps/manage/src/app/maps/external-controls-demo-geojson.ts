import type { Geometry } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';
import type { BoundaryMapFile } from './boundary-map.ts';

/**
 * Fictional boundary submissions for the /map-external-controls-demo page: three
 * overlapping polygons near Redditch standing in for successive scoping submissions
 * on a made-up case ("Arrow Valley Solar", EN0110033). Shapes are hand-drawn - enough
 * overlap that selecting one is visibly different from the others. Not real project data.
 */

function polygon(coordinates: [number, number][]): Geometry {
	return { type: 'Polygon', coordinates: [coordinates] };
}

export const EXTERNAL_CONTROLS_DEMO_CASE_NAME = 'Arrow Valley Solar';
export const EXTERNAL_CONTROLS_DEMO_CASE_REFERENCE = 'EN0110033';

/** A long north-south cable corridor - the newest file, drawn red. */
const CABLE_CORRIDOR: Geometry = polygon([
	[-1.965, 52.352],
	[-1.951, 52.352],
	[-1.953, 52.338],
	[-1.957, 52.318],
	[-1.963, 52.3],
	[-1.971, 52.293],
	[-1.976, 52.298],
	[-1.969, 52.318],
	[-1.967, 52.338],
	[-1.965, 52.352]
]);

/** A wider red-line boundary block overlapping the corridor's north end. */
const RED_LINE_BOUNDARY: Geometry = polygon([
	[-1.988, 52.348],
	[-1.928, 52.345],
	[-1.922, 52.32],
	[-1.938, 52.304],
	[-1.964, 52.302],
	[-1.979, 52.318],
	[-1.988, 52.348]
]);

/** An earlier boundary revision, offset slightly east of the red-line block. */
const EARLIER_BOUNDARY: Geometry = polygon([
	[-1.958, 52.342],
	[-1.914, 52.34],
	[-1.909, 52.312],
	[-1.928, 52.299],
	[-1.95, 52.307],
	[-1.958, 52.342]
]);

/**
 * The demo's shapefiles, newest first by receivedDate - `buildBoundaryMapConfig` ranks
 * them itself, so the order here only sets the radio order.
 */
export function buildExternalControlsDemoFiles(): BoundaryMapFile[] {
	return [
		{
			id: 'demo-cable-corridor',
			label: 'EN0110033_arrowvalleysolar_scoping_cablecorridor_110326.geojson',
			receivedDate: new Date('2026-03-11T14:32:00Z'),
			geometry: CABLE_CORRIDOR
		},
		{
			id: 'demo-red-line-boundary',
			label: 'EN0110033_arrowvalleysolar_scoping_rlb_270226.geojson',
			receivedDate: new Date('2026-02-27T09:15:00Z'),
			geometry: RED_LINE_BOUNDARY
		},
		{
			id: 'demo-earlier-boundary',
			label: 'EN0110033_arrowvalleysolar_scoping_boundary_090125.geojson',
			// no recorded date - the oldest submission; a radio with no "Uploaded" hint,
			// like real files whose received date is unknown
			receivedDate: null,
			geometry: EARLIER_BOUNDARY
		}
	];
}
