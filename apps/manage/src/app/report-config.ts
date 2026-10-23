import { CONFIG_DIR } from '@pins/identify-consultees-database/src/config-dir.ts';
import { groupForCategory } from '@pins/identify-consultees-database/src/seed/reference-data.ts';
import { load } from 'js-yaml';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NEARBY_NSIPS } from './views/consultees/nearby-nsips.ts';

/**
 * What the consultee report shows, from config/report.yaml: each workbook tab's fixed columns, the
 * metadata attributes each category exports after them, and how much each category's map shows
 * around the site - set by default, for a tab, and for a category on it, the nearest winning. See
 * the file for what each setting means.
 */

/** The workbook's fixed columns, by the name config/report.yaml uses, with their headings. */
export const REPORT_COLUMNS = {
	consultee: 'Consultee',
	category: 'Category',
	region: 'Region',
	whyIdentified: 'Why identified',
	source: 'Source',
	group: 'Group',
	subcategory: 'Subcategory',
	subcategoryDescription: 'Subcategory description',
	distanceKm: 'Distance from site (km)',
	consulteeAreaId: 'Consultee area id',
	sourceId: 'Source id',
	geometryType: 'Geometry type',
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

/** A tab's settings: its fixed columns, and its categories' metadata and map size unless they set their own. */
export interface TabReportSettings extends CategoryReportSettings {
	columns: ReportColumn[];
}

/** The workbook's tabs after Summary, in order: the groups of config/reference-data.yaml, then Nearby NSIPs. */
export const REPORT_TABS = [
	'Administrative boundaries',
	'Public bodies',
	'Energy',
	'Transport',
	'Other',
	NEARBY_NSIPS
] as const;

export type ReportTab = (typeof REPORT_TABS)[number];

/**
 * A line of the workbook's Summary tab: its label, and the categories it counts - only those a
 * condition with this buffer found nearest, when it has one (Ambulance Trusts within 1km, and within
 * 10km, on lines of their own).
 */
export interface SummaryLine {
	label: string;
	categories: string[];
	bufferKm?: number;
}

export interface ReportConfig {
	defaults: TabReportSettings;
	/** Each tab the file sets, over the defaults. */
	tabs: Partial<Record<ReportTab, TabReportSettings>>;
	/** Each category the file sets, over its tab's settings. */
	categories: Record<string, CategoryReportSettings>;
	/**
	 * Each tab's lines on the Summary tab, in the file's order: its categories' `summary` labels -
	 * categories sharing a label share a line.
	 */
	summaryLines: Partial<Record<ReportTab, SummaryLine[]>>;
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

function parseColumns(value: unknown, name: string): ReportColumn[] {
	// none is fine: a tab can be its metadata alone, as NSIPs' is
	if (!Array.isArray(value)) {
		fail(`${name}.columns must list the columns, [] for none`);
	}
	const columns: ReportColumn[] = [];
	for (const column of value) {
		if (typeof column !== 'string' || !(column in REPORT_COLUMNS)) {
			fail(
				`${name}.columns: "${String(column)}" isn't a column - use any of ${Object.keys(REPORT_COLUMNS).join(', ')}`
			);
		}
		if (columns.includes(column as ReportColumn)) {
			fail(`${name}.columns lists "${column}" twice`);
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
		fail(`${name}.metadata must be all, none, or attribute: column heading pairs`);
	}
	return Object.entries(value).map(([attribute, heading]) => {
		if (typeof heading !== 'string' || heading.trim() === '') {
			fail(`${name}.metadata.${attribute} must be a column heading`);
		}
		return { attribute, heading: heading.trim() };
	});
}

/** The tab a category's settings go under: its group's in config/reference-data.yaml, or Nearby NSIPs. */
export function tabForCategorySettings(category: string | null | undefined): ReportTab | undefined {
	if (category === NEARBY_NSIPS) {
		return NEARBY_NSIPS;
	}
	const group = groupForCategory(category)?.name;
	return REPORT_TABS.find((tab) => tab === group);
}

function parseTab(tab: ReportTab, value: unknown, defaults: TabReportSettings): TabReportSettings {
	const name = `tabs.${tab}`;
	if (!isRecord(value)) {
		fail(`${name} must be a tab's settings - {} for the defaults`);
	}
	onlyKeys(value, ['columns', 'metadata', 'mapKm', 'categories'], name);
	return {
		columns: value.columns === undefined ? defaults.columns : parseColumns(value.columns, name),
		metadata: value.metadata === undefined ? defaults.metadata : parseMetadata(value.metadata, name),
		mapMarginMetres: value.mapKm === undefined ? defaults.mapMarginMetres : parseMapKm(value.mapKm, name)
	};
}

function parseCategory(tab: ReportTab, category: string, value: unknown, settings: TabReportSettings) {
	const name = `tabs.${tab}.categories.${category}`;
	const home = tabForCategorySettings(category);
	if (home !== tab) {
		fail(
			`${name}: ${category} isn't on ${tab} - config/reference-data.yaml puts it in ${home ?? 'no group'}; list it there`
		);
	}
	if (!isRecord(value)) {
		fail(`${name} must set metadata, mapKm or summary`);
	}
	onlyKeys(value, ['metadata', 'mapKm', 'summary'], name);
	return {
		settings: {
			metadata: value.metadata === undefined ? settings.metadata : parseMetadata(value.metadata, name),
			mapMarginMetres: value.mapKm === undefined ? settings.mapMarginMetres : parseMapKm(value.mapKm, name)
		},
		summary: value.summary === undefined ? [] : parseSummary(value.summary, name)
	};
}

function isLabel(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

/**
 * A category's Summary lines: one label, or a label for each buffer its conditions find it within -
 * `{ 1: Ambulance Trusts (1km buffer), 10: Ambulance Trusts (10km buffer) }`.
 */
function parseSummary(value: unknown, name: string): { label: string; bufferKm?: number }[] {
	if (isLabel(value)) {
		return [{ label: value.trim() }];
	}
	const byBuffer = isRecord(value) ? Object.entries(value) : [];
	if (byBuffer.length === 0 || !byBuffer.every(([km, label]) => Number(km) >= 0 && isLabel(label))) {
		fail(`${name}.summary must be the label the Summary tab gives it, or a label for each buffer in km`);
	}
	return byBuffer.map(([km, label]) => ({ label: (label as string).trim(), bufferKm: Number(km) }));
}

export function parseReportConfig(text: string): ReportConfig {
	const document = text.trim() === '' ? null : load(text);
	if (!isRecord(document) || document.version !== 2) {
		fail('must be a version 2 document');
	}
	onlyKeys(document, ['version', 'defaults', 'tabs'], 'the document');
	if (!isRecord(document.defaults)) {
		fail('defaults must set columns, metadata and mapKm');
	}
	onlyKeys(document.defaults, ['columns', 'metadata', 'mapKm'], 'defaults');
	const defaults: TabReportSettings = {
		columns: parseColumns(document.defaults.columns, 'defaults'),
		metadata: parseMetadata(document.defaults.metadata, 'defaults'),
		mapMarginMetres: parseMapKm(document.defaults.mapKm, 'defaults')
	};
	const tabsSection = document.tabs ?? {};
	if (!isRecord(tabsSection)) {
		fail('tabs must map each tab to its settings');
	}
	const tabs: Partial<Record<ReportTab, TabReportSettings>> = {};
	const categories: Record<string, CategoryReportSettings> = {};
	const summaryLines: Partial<Record<ReportTab, SummaryLine[]>> = {};
	for (const [tab, value] of Object.entries(tabsSection)) {
		if (!REPORT_TABS.includes(tab as ReportTab)) {
			fail(`tabs: "${tab}" isn't a tab - use any of ${REPORT_TABS.join(', ')}`);
		}
		const settings = parseTab(tab as ReportTab, value, defaults);
		tabs[tab as ReportTab] = settings;
		const listed = (value as Record<string, unknown>).categories ?? {};
		if (!isRecord(listed)) {
			fail(`tabs.${tab}.categories must map each category to its settings`);
		}
		for (const [category, categoryValue] of Object.entries(listed)) {
			const parsed = parseCategory(tab as ReportTab, category, categoryValue, settings);
			categories[category] = parsed.settings;
			for (const { label, bufferKm } of parsed.summary) {
				const lines = (summaryLines[tab as ReportTab] ??= []);
				const line = lines.find((candidate) => candidate.label === label && candidate.bufferKm === bufferKm);
				if (line) {
					line.categories.push(category);
				} else {
					lines.push({ label, categories: [category], ...(bufferKm === undefined ? {} : { bufferKm }) });
				}
			}
		}
	}
	return { defaults, tabs, categories, summaryLines };
}

/** A tab's lines on the Summary tab, in order - none if its categories set no `summary`. */
export function summaryLines(tab: ReportTab, config: ReportConfig = REPORT_CONFIG): SummaryLine[] {
	return config.summaryLines[tab] ?? [];
}

/** A tab's settings: its own, or the defaults. */
export function tabSettings(tab: ReportTab, config: ReportConfig = REPORT_CONFIG): TabReportSettings {
	return config.tabs[tab] ?? config.defaults;
}

/**
 * A category's settings: its own, else its tab's (its group's in config/reference-data.yaml), else
 * the defaults.
 */
export function categorySettings(
	category: string | null | undefined,
	config: ReportConfig = REPORT_CONFIG
): CategoryReportSettings {
	if (category && Object.hasOwn(config.categories, category)) {
		return config.categories[category];
	}
	const tab = tabForCategorySettings(category);
	return tab ? tabSettings(tab, config) : config.defaults;
}

export const REPORT_CONFIG = parseReportConfig(readFileSync(path.join(CONFIG_DIR, FILE), 'utf8'));
