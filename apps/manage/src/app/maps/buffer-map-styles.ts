import { CONFIG_DIR } from '@pins/identify-consultees-database/src/config-dir.ts';
import path from 'node:path';
import type { DefraStyleConfig } from './style-utils.ts';
import { HEX_COLOUR, isRecord, loadVersionedMapStylesFile, onlyKeys } from './style-utils.ts';

export interface BufferFileStyle {
	colour: string;
	strokeWidth: number;
	strokeDash: [number, number];
	description: string;
}

export interface BufferMapStyles {
	buffers: BufferFileStyle[];
}

export interface BufferDatasetStyle {
	stroke: DefraStyleConfig['stroke'];
	strokeWidth: DefraStyleConfig['strokeWidth'];
	strokeDashArray: DefraStyleConfig['strokeDashArray'];
	symbolDescription: DefraStyleConfig['symbolDescription'];
}

export function parseBorderStyles(value: unknown, path: string, stylePath: string): BufferFileStyle {
	if (!isRecord(value)) {
		throw new Error(`${path} must be a style`);
	}

	onlyKeys(value, ['colour', 'strokeWidth', 'strokeDash', 'description'], stylePath, path);

	const { colour, strokeWidth, strokeDash, description } = value;
	if (typeof colour !== 'string' || !HEX_COLOUR.test(colour)) {
		throw new Error(`${path}.colour must be a 6-digit hex colour, like '#C44E52'`);
	}
	if (typeof strokeWidth !== 'number' || strokeWidth < 0 || strokeWidth > 2) {
		throw new Error(`${path}.strokeWidth must be a number from 0 to 2`);
	}
	if (!Array.isArray(strokeDash) || !strokeDash.every((dash) => typeof dash === 'number')) {
		throw new Error(`${path}.strokeDash must an array of numbers`);
	}
	if (typeof description !== 'string' || description.trim() === '') {
		throw new Error(`${path}.description must describe the style in words`);
	}
	return {
		colour,
		strokeWidth,
		strokeDash: strokeDash as [number, number],
		description
	};
}

export function parseConsulteeMapStyles(document: Record<string, unknown>, stylePath: string) {
	onlyKeys(document, ['version', 'bufferStyles'], stylePath, 'the document');
	if (!Array.isArray(document.bufferStyles) || document.bufferStyles.length === 0) {
		throw new Error(`${stylePath}: earlier must list at least one style`);
	}

	const bufferStyles = document.bufferStyles.map((borderStyle: unknown) =>
		parseBorderStyles(borderStyle, 'bufferStyles', stylePath)
	);

	return {
		buffers: bufferStyles
	};
}

export function readConsulteeMapStyles(stylePath: string) {
	const document = loadVersionedMapStylesFile(stylePath, 1);
	return parseConsulteeMapStyles(document, stylePath);
}

export const BUFFER_MAP_STYLES = readConsulteeMapStyles(path.join(CONFIG_DIR, 'map-styles', 'buffer-map.yaml'));

export function toBufferDatasetStyle(style: BufferFileStyle): BufferDatasetStyle {
	return {
		stroke: style.colour,
		strokeWidth: style.strokeWidth,
		strokeDashArray: style.strokeDash,
		symbolDescription: style.description
	};
}
