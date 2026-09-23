import type { GeoJsonFeatureCollection } from './sample-geojson.ts';
import { MAP_VIEWPORT } from './sample-geojson.ts';

type LngLat = readonly [number, number];

/**
 * Progressive-enhancement static SVG map (spike-aligned contract).
 * Renders polygons on a pale background when JavaScript is unavailable.
 * Full OSM-tile basemap from the data spike can replace this later.
 */
export function buildStaticMapSvg(options: {
	center: LngLat;
	zoom: number;
	projectGeojson: GeoJsonFeatureCollection;
	consulteeGeojson: GeoJsonFeatureCollection;
	width?: number;
	height?: number;
}): string {
	const width = options.width ?? MAP_VIEWPORT.width;
	const height = options.height ?? MAP_VIEWPORT.height;
	const [centerLng, centerLat] = options.center;
	const scale = Math.pow(2, options.zoom) * 8;

	const projectPaths = options.projectGeojson.features
		.map((feature) => polygonToSvgPath(feature.geometry.coordinates, centerLng, centerLat, scale, width, height))
		.join('');
	const consulteePaths = options.consulteeGeojson.features
		.map((feature) => polygonToSvgPath(feature.geometry.coordinates, centerLng, centerLat, scale, width, height))
		.join('');

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <title>Static map of project site and consultee areas</title>
  <rect width="100%" height="100%" fill="#f5f5f0"/>
  <g fill="#55A868" fill-opacity="0.35" stroke="#55A868" stroke-width="2">${consulteePaths}</g>
  <g fill="#C44E52" fill-opacity="0.45" stroke="#C44E52" stroke-width="2">${projectPaths}</g>
</svg>`;
}

function polygonToSvgPath(
	coordinates: number[][][],
	centerLng: number,
	centerLat: number,
	scale: number,
	width: number,
	height: number
): string {
	const ring = coordinates[0];
	if (!ring?.length) {
		return '';
	}

	const points = ring
		.map(([lng, lat], index) => {
			const x = width / 2 + (lng - centerLng) * scale;
			const y = height / 2 - (lat - centerLat) * scale;
			return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
		})
		.join(' ');

	return `<path d="${points} Z"/>`;
}
