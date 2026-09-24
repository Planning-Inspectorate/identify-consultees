import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { buildMapLayersDemoCollections } from '../../maps/map-layers-demo-geojson.ts';
import { MAP_VIEWPORT } from '../../maps/sample-geojson.ts';
import type { MapLayersDemoViewModel } from './view-model.ts';

const MAP_ID = 'map-layers-demo';

/**
 * Prototype page demonstrating Defra Interactive Map layer toggles
 * (project site, railways, roads, constraint area) via the built-in Layers panel.
 */
export function buildMapLayersDemoPage(): AsyncRequestHandler {
	return async (_req, res) => {
		const { projectGeojson, railwayGeojson, roadGeojson, constraintGeojson, mapView } = buildMapLayersDemoCollections();

		const mapConfig = {
			center: mapView.center,
			zoom: mapView.zoom,
			width: MAP_VIEWPORT.width,
			height: MAP_VIEWPORT.height,
			mapLabel: 'Map layers demo — use Layers to show or hide overlays',
			projectGeojson,
			railwayGeojson,
			roadGeojson,
			constraintGeojson,
			projectLayerLabel: 'Project site',
			railwayLayerLabel: 'Railway lines',
			roadLayerLabel: 'Road network',
			constraintLayerLabel: 'Flood risk area'
		};

		const model: MapLayersDemoViewModel = {
			pageHeading: 'Map layers demo',
			mapId: MAP_ID,
			mapRegionLabel: 'Interactive map with toggleable overlay layers',
			mapWidth: MAP_VIEWPORT.width,
			mapHeight: MAP_VIEWPORT.height,
			mapConfigJson: JSON.stringify(mapConfig).replace(/</g, '\\u003c'),
			layerSummaries: [
				{
					label: 'Project site',
					description: 'Polygon overlay for the indicative project boundary.'
				},
				{
					label: 'Railway lines',
					description: 'Line overlays representing train tracks (prototype GeoJSON, not live OSM tiles).'
				},
				{
					label: 'Road network',
					description: 'Line overlays representing major and local roads around the site.'
				},
				{
					label: 'Flood risk area',
					description: 'Polygon overlay for an indicative environmental constraint.'
				}
			]
		};

		res.render('views/map-layers-demo/view.njk', model);
	};
}
