import { load } from 'js-yaml';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** A file's style as the Defra datasets plugin takes it (see consultees-map.js). */
export interface DefraStyleConfig {
	stroke: string;
	strokeWidth: number;
	strokeDashArray: [number, number];
	fill: string;
	symbolDescription: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Refuse keys `section` doesn't have - a misspelt optional one (strokeDash) would otherwise be ignored. */
export function onlyKeys(section: Record<string, unknown>, allowed: string[], stylePath: string, path: string): void {
	const unknown = Object.keys(section).filter((key) => !allowed.includes(key));
	if (unknown.length > 0) {
		throw new Error(
			`${stylePath}: ${path} has ${unknown.map((key) => `"${key}"`).join(', ')} - it can only have ${allowed.join(', ')}`
		);
	}
}

export function loadVersionedMapStylesFile(filename: string, version: number) {
	const text = readFileSync(path.join(filename), 'utf8');

	const document = text.trim() === '' ? null : load(text);
	if (!isRecord(document) || document.version !== version) {
		throw new Error(`${filename} must be a version ${version} document`);
	}

	return document;
}

export const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;
