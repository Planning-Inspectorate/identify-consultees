import { CONFIG_DIR } from '@pins/identify-consultees-database/src/config-dir.ts';
import { load } from 'js-yaml';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * How much the project boundary page's map shows around the case's shapefiles when it opens, from
 * config/map-view.yaml - the margin computeFittedMapView keeps. The consultee maps' are per
 * category, in config/report.yaml.
 */
export interface MapView {
	boundaryMapMarginMetres: number;
}

// a map showing more than this around a site is one of England and Wales, not of a site
const MAX_MARGIN_KM = 500;

function marginMetres(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_MARGIN_KM) {
		throw new Error(`map-view.yaml: ${name} must be a number of km from 0 to ${MAX_MARGIN_KM}`);
	}
	return value * 1000;
}

export function parseMapView(text: string): MapView {
	const document = (text.trim() === '' ? null : load(text)) as Record<string, unknown> | null;
	if (typeof document !== 'object' || document === null || document.version !== 1) {
		throw new Error('map-view.yaml must be a version 1 document');
	}
	return {
		boundaryMapMarginMetres: marginMetres(document.boundaryMapKm, 'boundaryMapKm')
	};
}

export const MAP_VIEW = parseMapView(readFileSync(path.join(CONFIG_DIR, 'map-view.yaml'), 'utf8'));
