import { CONFIG_DIR } from '@pins/identify-consultees-database/src/config-dir.ts';
import { load } from 'js-yaml';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * How a site too detailed to screen in time is handled, from config/screening.yaml - see the file.
 */
export interface ScreeningConfig {
	/** Screen a site whose simplified outline has more points than this against its bounding box; 0 never does up front. */
	boundingBoxAbovePoints: number;
}

const SCREENING_FILE = path.join(CONFIG_DIR, 'screening.yaml');

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseScreeningConfig(text: string): ScreeningConfig {
	const document = text.trim() === '' ? null : load(text);
	if (!isRecord(document) || document.version !== 1) {
		throw new Error('screening.yaml must be a version 1 document');
	}
	const points = document.boundingBoxAbovePoints;
	if (typeof points !== 'number' || !Number.isInteger(points) || points < 0) {
		throw new Error('screening.yaml: boundingBoxAbovePoints must be a whole number of points, 0 or more');
	}
	return { boundingBoxAbovePoints: points };
}

export function loadScreeningConfig(file: string = SCREENING_FILE): ScreeningConfig {
	return parseScreeningConfig(readFileSync(file, 'utf8'));
}
