import { CONFIG_DIR } from '@pins/identify-consultees-database/src/config-dir.ts';
import { load } from 'js-yaml';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * What the consultee report shows for each consultee category, from config/report.yaml: how much
 * the category's map shows around the site, and the downloaded workbook's columns - its fixed
 * columns, then each category's metadata attributes. See the file for what each setting means.
 */

/** The workbook's fixed columns, by the name config/report.yaml uses, with their headings. */
export const REPORT_COLUMNS = {
	consultee: 'Consultee',
	category: 'Category',
	region: 'Region',
	whyIdentified: 'Why identified',
	source: 'Source',
	version: 'Version',
	distanceKm: 'Distance from site (km)',
	consulteeAreaId: 'Consultee area id',
	geometryType: 'Geometry type',
	caseReference: 'Case reference',
	lastUpdated: 'Last updated'
} as const;

export type ReportColumn = keyof typeof REPORT_COLUMNS;

/** Which metadata attributes a category exports: all, none, or these attributes under these headings. */
export type MetadataSelection = 'all' | 'none' | { attribute: string; heading: string }[];

export interface CategoryReportSettings {
	/** The least distance its map shows around the site, on every side. */
	mapMarginMetres: number;
	metadata: MetadataSelection;
}

export interface ReportConfig {
	columns: ReportColumn[];
	defaults: CategoryReportSettings;
	categories: Record<string, CategoryReportSettings>;
}

const FILE = 'report.yaml';
// a map showing more than this around a site is one of England and Wales, not of a site
const MAX_MAP_KM = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
	throw new Error(`${FILE}: ${message}`);
}

/** Refuse keys a section doesn't have - a typo would otherwise be silently ignored. */
function onlyKeys(section: Record<string, unknown>, allowed: string[], name: string): void {
	const unknown = Object.keys(section).filter((key) => !allowed.includes(key));
	if (unknown.length > 0) {
		fail(`${name} has ${unknown.map((key) => `"${key}"`).join(', ')} - it can only have ${allowed.join(', ')}`);
	}
}

function parseColumns(value: unknown): ReportColumn[] {
	if (!Array.isArray(value) || value.length === 0) {
		fail('columns must list at least one column');
	}
	const columns: ReportColumn[] = [];
	for (const column of value) {
		if (typeof column !== 'string' || !(column in REPORT_COLUMNS)) {
			fail(`columns: "${String(column)}" isn't a column - use any of ${Object.keys(REPORT_COLUMNS).join(', ')}`);
		}
		if (columns.includes(column as ReportColumn)) {
			fail(`columns lists "${column}" twice`);
		}
		columns.push(column as ReportColumn);
	}
	return columns;
}

function parseMapKm(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_MAP_KM) {
		fail(`${name}.mapKm must be a number of km from 0 to ${MAX_MAP_KM}`);
	}
	return value * 1000;
}

function parseMetadata(value: unknown, name: string): MetadataSelection {
	if (value === 'all' || value === 'none') {
		return value;
	}
	if (!isRecord(value) || Object.keys(value).length === 0) {
		fail(`${name}.metadata must be all, none, or a list of attribute: column heading`);
	}
	return Object.entries(value).map(([attribute, heading]) => {
		if (typeof heading !== 'string' || heading.trim() === '') {
			fail(`${name}.metadata.${attribute} must be a column heading`);
		}
		return { attribute, heading: heading.trim() };
	});
}

function parseSettings(value: unknown, name: string, fallback?: CategoryReportSettings): CategoryReportSettings {
	if (!isRecord(value)) {
		fail(`${name} must set mapKm and metadata`);
	}
	onlyKeys(value, ['mapKm', 'metadata'], name);
	if (!fallback && (value.mapKm === undefined || value.metadata === undefined)) {
		fail(`${name} must set both mapKm and metadata`);
	}
	return {
		mapMarginMetres: value.mapKm === undefined ? fallback!.mapMarginMetres : parseMapKm(value.mapKm, name),
		metadata: value.metadata === undefined ? fallback!.metadata : parseMetadata(value.metadata, name)
	};
}

export function parseReportConfig(text: string): ReportConfig {
	const document = text.trim() === '' ? null : load(text);
	if (!isRecord(document) || document.version !== 1) {
		fail('must be a version 1 document');
	}
	onlyKeys(document, ['version', 'columns', 'defaults', 'categories'], 'the document');
	const defaults = parseSettings(document.defaults, 'defaults');
	const categories = document.categories ?? {};
	if (!isRecord(categories)) {
		fail('categories must map each category to its settings');
	}
	return {
		columns: parseColumns(document.columns),
		defaults,
		categories: Object.fromEntries(
			Object.entries(categories).map(([category, settings]) => [
				category,
				parseSettings(settings, `categories.${category}`, defaults)
			])
		)
	};
}

/** A category's settings: its own, or the defaults for anything it leaves out. */
export function categorySettings(category: string | null | undefined, config: ReportConfig = REPORT_CONFIG) {
	return category && Object.hasOwn(config.categories, category) ? config.categories[category] : config.defaults;
}

export const REPORT_CONFIG = parseReportConfig(readFileSync(path.join(CONFIG_DIR, FILE), 'utf8'));
