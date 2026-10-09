/**
 * Build the map config for the project boundary page: one dataset per shapefile the case holds,
 * grouped under "GIS shapefiles" in the map's Layers menu so each file can be toggled on or off.
 * Only the file carried forward (the current selection) starts visible - the rest are unchecked,
 * matching the radios below the map.
 */

import type { Geometry } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';
import { computeMapView } from './geometry-bounds.ts';
import type { GeoJsonFeature, GeoJsonFeatureCollection } from './sample-geojson.ts';
import { MAP_VIEWPORT } from './sample-geojson.ts';

import type { StaticMapFallbackConfig } from './case-geojson.ts';

// ~1m - plenty for drawing, and coordinates are most of the layer's size (same as case-geojson.ts)
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

/** One shapefile the boundary page draws - a file option (see project/boundary-files.ts) with its geometry. */
export interface BoundaryMapFile {
	/** The file option's id - becomes the dataset's id (and its feature's fileKey). */
	id: string;
	/** The file's name - the dataset's label in the Layers menu and the radio's text. */
	label: string;
	/** True for the file carried into the report - it starts checked in the Layers menu. */
	checked: boolean;
	geometry: Geometry;
}

export interface BoundaryMapConfig {
	center: readonly [number, number];
	zoom: number;
	width: number;
	height: number;
	mapLabel: string;
	/** The Layers-menu group every shapefile dataset sits under. */
	shapefileGroupLabel: string;
	/** One entry per shapefile - consultees-map.js turns each into a datasets-plugin dataset. */
	shapefileDatasets: {
		id: string;
		label: string;
		checked: boolean;
		geojson: GeoJsonFeatureCollection;
	}[];
	/** The JS init-failure fallback's static-map image - see CaseMapConfig.fallback. */
	fallback?: StaticMapFallbackConfig;
}

function toGeojson(file: BoundaryMapFile, caseReference: string): GeoJsonFeatureCollection {
	const feature: GeoJsonFeature = {
		type: 'Feature',
		id: file.id,
		properties: {
			fileKey: file.id,
			name: file.label,
			reference: caseReference
		},
		geometry: roundGeometry(file.geometry)
	};
	return { type: 'FeatureCollection', features: [feature] };
}

export function buildBoundaryMapConfig(
	caseName: string,
	caseReference: string,
	files: BoundaryMapFile[],
	fallback?: { src: string; alt: string }
): BoundaryMapConfig {
	const datasets = files.map((file) => ({
		id: `shapefile-${file.id}`,
		label: file.label,
		checked: file.checked,
		geojson: toGeojson(file, caseReference)
	}));
	const view = computeMapView({ features: datasets.flatMap((dataset) => dataset.geojson.features) });

	return {
		center: view.center,
		zoom: view.zoom,
		width: MAP_VIEWPORT.width,
		height: MAP_VIEWPORT.height,
		mapLabel: `Project boundary for ${caseName} (${caseReference})`,
		shapefileGroupLabel: 'GIS shapefiles',
		shapefileDatasets: datasets,
		...(fallback ? { fallback: { ...fallback, width: MAP_VIEWPORT.width, height: MAP_VIEWPORT.height } } : {})
	};
}
