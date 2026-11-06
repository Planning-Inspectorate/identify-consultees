import type { Geometry } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';

export const MAP_VIEWPORT = {
	width: 960,
	height: 516
} as const;

export type GeoJsonFeatureCollection = {
	type: 'FeatureCollection';
	features: GeoJsonFeature[];
};

export type GeoJsonFeature = {
	type: 'Feature';
	id?: string | number;
	properties: Record<string, string>;
	geometry: Geometry;
};
