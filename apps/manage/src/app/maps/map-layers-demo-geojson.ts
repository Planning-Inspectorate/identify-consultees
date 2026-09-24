import { computeMapView } from './geometry-bounds.ts';
import { buildProjectSiteGeojson } from './sample-geojson.ts';

/**
 * Prototype LineString / Polygon overlays near the Dorset coast project site.
 * Used only by the map-layers demo to show Defra Layers toggles — not live OSM tiles.
 */

export type OverlayGeoJsonFeatureCollection = {
	type: 'FeatureCollection';
	features: OverlayGeoJsonFeature[];
};

export type OverlayGeoJsonFeature = {
	type: 'Feature';
	id?: string | number;
	properties: Record<string, string>;
	geometry:
		| {
				type: 'LineString';
				coordinates: number[][];
		  }
		| {
				type: 'Polygon';
				coordinates: number[][][];
		  };
};

/** Schematic railway corridor through / past the project area. */
export function buildRailwayGeojson(): OverlayGeoJsonFeatureCollection {
	return {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				id: 'railway-main',
				properties: {
					name: 'Main line (prototype)',
					layer: 'railways'
				},
				geometry: {
					type: 'LineString',
					coordinates: [
						[-1.92, 50.68],
						[-1.86, 50.66],
						[-1.8, 50.635],
						[-1.74, 50.61],
						[-1.68, 50.59]
					]
				}
			},
			{
				type: 'Feature',
				id: 'railway-branch',
				properties: {
					name: 'Branch line (prototype)',
					layer: 'railways'
				},
				geometry: {
					type: 'LineString',
					coordinates: [
						[-1.8, 50.635],
						[-1.78, 50.655],
						[-1.75, 50.67]
					]
				}
			}
		]
	};
}

/** Schematic major roads around the project area. */
export function buildRoadNetworkGeojson(): OverlayGeoJsonFeatureCollection {
	return {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				id: 'road-a-road',
				properties: {
					name: 'A-road (prototype)',
					layer: 'roads'
				},
				geometry: {
					type: 'LineString',
					coordinates: [
						[-1.9, 50.58],
						[-1.84, 50.6],
						[-1.78, 50.62],
						[-1.72, 50.64],
						[-1.66, 50.66]
					]
				}
			},
			{
				type: 'Feature',
				id: 'road-local',
				properties: {
					name: 'Local road (prototype)',
					layer: 'roads'
				},
				geometry: {
					type: 'LineString',
					coordinates: [
						[-1.85, 50.64],
						[-1.81, 50.62],
						[-1.77, 50.6],
						[-1.73, 50.58]
					]
				}
			}
		]
	};
}

/** Schematic flood / environmental constraint polygon for a third toggleable layer. */
export function buildConstraintAreaGeojson(): OverlayGeoJsonFeatureCollection {
	return {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				id: 'constraint-flood',
				properties: {
					name: 'Indicative flood risk area (prototype)',
					layer: 'constraints'
				},
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[-1.82, 50.6],
							[-1.74, 50.6],
							[-1.74, 50.64],
							[-1.82, 50.64],
							[-1.82, 50.6]
						]
					]
				}
			}
		]
	};
}

export function buildMapLayersDemoCollections() {
	const projectGeojson = buildProjectSiteGeojson('EN0100001', 'Navitus Bay Wind Park (demo)');
	const railwayGeojson = buildRailwayGeojson();
	const roadGeojson = buildRoadNetworkGeojson();
	const constraintGeojson = buildConstraintAreaGeojson();

	const mapView = computeMapView({
		features: [
			...projectGeojson.features,
			...railwayGeojson.features,
			...roadGeojson.features,
			...constraintGeojson.features
		]
	});

	return {
		projectGeojson,
		railwayGeojson,
		roadGeojson,
		constraintGeojson,
		mapView
	};
}
