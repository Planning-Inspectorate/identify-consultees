import { CONFIG_DIR } from '@pins/identify-consultees-database/src/config-dir.ts';
import yaml from 'js-yaml';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Styles for the project boundary page's map, from config/map-styles/boundary-map.yaml: the most recent
 * boundary file in one style (red), each earlier file in the next of a list. Read and checked once
 * when the app starts, so an invalid file stops the app rather than drawing a broken map.
 */

export interface BoundaryFileStyle {
	colour: string;
	fillOpacity: number;
	strokeWidth: number;
	strokeDash?: [number, number];
	description: string;
}

export interface BoundaryMapStyles {
	mostRecent: BoundaryFileStyle;
	earlier: BoundaryFileStyle[];
}

/** A file's style as the Defra datasets plugin takes it (see consultees-map.js). */
export interface BoundaryDatasetStyle {
	stroke: string;
	strokeWidth: number;
	strokeDashArray?: [number, number];
	fill: string;
	symbolDescription: string;
}

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStyle(value: unknown, path: string): BoundaryFileStyle {
	if (!isRecord(value)) {
		throw new Error(`${path} must be a style`);
	}
	const { colour, fillOpacity, strokeWidth, strokeDash, description } = value;
	if (typeof colour !== 'string' || !HEX_COLOUR.test(colour)) {
		throw new Error(`${path}.colour must be a 6-digit hex colour, like '#C44E52'`);
	}
	if (typeof fillOpacity !== 'number' || fillOpacity < 0 || fillOpacity > 1) {
		throw new Error(`${path}.fillOpacity must be a number from 0 to 1`);
	}
	if (typeof strokeWidth !== 'number' || strokeWidth <= 0) {
		throw new Error(`${path}.strokeWidth must be a number above 0`);
	}
	if (
		strokeDash !== undefined &&
		!(
			Array.isArray(strokeDash) &&
			strokeDash.length === 2 &&
			strokeDash.every((part) => typeof part === 'number' && part > 0)
		)
	) {
		throw new Error(`${path}.strokeDash must be [dash, gap], two numbers above 0`);
	}
	if (typeof description !== 'string' || description.trim() === '') {
		throw new Error(`${path}.description must describe the style in words`);
	}
	return {
		colour,
		fillOpacity,
		strokeWidth,
		...(strokeDash ? { strokeDash: strokeDash as [number, number] } : {}),
		description
	};
}

export function parseBoundaryMapStyles(text: string): BoundaryMapStyles {
	const document = yaml.load(text);
	if (!isRecord(document) || document.version !== 1) {
		throw new Error('config/map-styles/boundary-map.yaml must be a version 1 document');
	}
	if (!Array.isArray(document.earlier) || document.earlier.length === 0) {
		throw new Error('config/map-styles/boundary-map.yaml: earlier must list at least one style');
	}
	return {
		mostRecent: parseStyle(document.mostRecent, 'mostRecent'),
		earlier: document.earlier.map((style, index) => parseStyle(style, `earlier[${index}]`))
	};
}

export const BOUNDARY_MAP_STYLES = parseBoundaryMapStyles(
	readFileSync(path.join(CONFIG_DIR, 'map-styles', 'boundary-map.yaml'), 'utf8')
);

/**
 * Each file's position by received date: 0 for the most recent, then 1, 2... A file with no date
 * counts as oldest, and ties keep the order they came in.
 */
export function recencyRanks(receivedDates: (Date | null)[]): number[] {
	const order = receivedDates
		.map((date, index) => ({ time: date?.getTime() ?? Number.NEGATIVE_INFINITY, index }))
		.sort((a, b) => b.time - a.time || a.index - b.index);
	const ranks = new Array<number>(receivedDates.length);
	order.forEach(({ index }, rank) => {
		ranks[index] = rank;
	});
	return ranks;
}

export function styleForRank(rank: number, styles: BoundaryMapStyles = BOUNDARY_MAP_STYLES): BoundaryFileStyle {
	return rank === 0 ? styles.mostRecent : styles.earlier[(rank - 1) % styles.earlier.length];
}

function rgba(hex: string, alpha: number): string {
	const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function toDatasetStyle(style: BoundaryFileStyle): BoundaryDatasetStyle {
	return {
		stroke: style.colour,
		strokeWidth: style.strokeWidth,
		...(style.strokeDash ? { strokeDashArray: style.strokeDash } : {}),
		fill: rgba(style.colour, style.fillOpacity),
		symbolDescription: style.description
	};
}
