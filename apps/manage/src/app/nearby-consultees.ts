import { CONFIG_DIR } from '@pins/identify-consultees-database/src/config-dir.ts';
import { load } from 'js-yaml';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * How far around a site the maps show consultees the ruleset didn't identify, from
 * config/nearby-consultees.yaml: a default, and a distance per category. Sent with every ruleset
 * run, so the Python function counts each area as nearby within its own category's distance.
 */
export interface NearbyConsultees {
	defaultRadiusMetres: number;
	/** A category's own distance; 0 means it's never shown as nearby. */
	radiusMetresByCategory: Record<string, number>;
}

export const NEARBY_CONSULTEES_FILE = path.join(CONFIG_DIR, 'nearby-consultees.yaml');

// the Python function refuses distances over 500km (MAX_DISTANCE_METRES in intersector/api.py)
const MAX_RADIUS_KM = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function radiusMetres(value: unknown, name: string, allowZero: boolean): number {
	const valid =
		typeof value === 'number' &&
		Number.isFinite(value) &&
		(allowZero ? value >= 0 : value > 0) &&
		value <= MAX_RADIUS_KM;
	if (!valid) {
		throw new Error(
			`nearby-consultees.yaml: ${name} must be a number of km ${allowZero ? 'from 0' : 'above 0'} to ${MAX_RADIUS_KM}`
		);
	}
	return value * 1000;
}

export function parseNearbyConsultees(text: string): NearbyConsultees {
	const document = text.trim() === '' ? null : load(text);
	if (!isRecord(document) || document.version !== 1) {
		throw new Error('nearby-consultees.yaml must be a version 1 document');
	}
	const categories = document.categories ?? {};
	if (!isRecord(categories)) {
		throw new Error('nearby-consultees.yaml: categories must map each category to a distance in km');
	}
	return {
		defaultRadiusMetres: radiusMetres(document.defaultRadiusKm, 'defaultRadiusKm', false),
		radiusMetresByCategory: Object.fromEntries(
			Object.entries(categories).map(([category, km]) => [category, radiusMetres(km, `categories.${category}`, true)])
		)
	};
}

export function loadNearbyConsultees(file: string = NEARBY_CONSULTEES_FILE): NearbyConsultees {
	return parseNearbyConsultees(readFileSync(file, 'utf8'));
}

/**
 * How far the search, and the map's search area, reach: the largest distance configured, so every
 * category's nearby consultees are found and drawn.
 */
export function searchRadiusMetres(nearby: NearbyConsultees): number {
	return Math.max(nearby.defaultRadiusMetres, ...Object.values(nearby.radiusMetresByCategory));
}
