import { computeMapView } from './geometry-bounds.ts';

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
	geometry: {
		type: 'Polygon';
		coordinates: number[][][];
	};
};

function squareAround(lng: number, lat: number, halfSizeDegrees: number): number[][][] {
	return [
		[
			[lng - halfSizeDegrees, lat - halfSizeDegrees],
			[lng + halfSizeDegrees, lat - halfSizeDegrees],
			[lng + halfSizeDegrees, lat + halfSizeDegrees],
			[lng - halfSizeDegrees, lat + halfSizeDegrees],
			[lng - halfSizeDegrees, lat - halfSizeDegrees]
		]
	];
}

/** Prototype polygons near the Dorset coast (Navitus Bay area). */
export function buildProjectSiteGeojson(reference: string, caseName: string): GeoJsonFeatureCollection {
	return {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				id: 'project-site',
				properties: {
					name: caseName,
					reference,
					layer: 'project-site'
				},
				geometry: {
					type: 'Polygon',
					coordinates: squareAround(-1.78, 50.62, 0.04)
				}
			}
		]
	};
}

export function buildConsulteeAreaGeojson(
	category: string,
	areas: { name: string; code: string; offsetLng: number; offsetLat: number; size: number }[]
): GeoJsonFeatureCollection {
	return {
		type: 'FeatureCollection',
		features: areas.map((area, index) => ({
			type: 'Feature',
			id: `${category}-${index}`,
			properties: {
				name: area.name,
				referenceAreaCode: area.code,
				referenceAreaName: area.name,
				consulteeCategory: category
			},
			geometry: {
				type: 'Polygon',
				coordinates: squareAround(-1.78 + area.offsetLng, 50.62 + area.offsetLat, area.size)
			}
		}))
	};
}

export function mapViewForCollections(...collections: GeoJsonFeatureCollection[]) {
	return computeMapView({
		features: collections.flatMap((collection) => collection.features)
	});
}
