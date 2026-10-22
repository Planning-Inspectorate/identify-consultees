import type {
	ConsulteeMatch,
	Ruleset,
	SiteScreenedAs
} from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { SheetData } from 'write-excel-file/node';
import type { MetadataSelection, ReportColumn, ReportConfig } from '../../../../report-config.ts';
import {
	categorySettings,
	REPORT_COLUMNS,
	REPORT_CONFIG,
	REPORT_TABS,
	tabSettings
} from '../../../../report-config.ts';
import { NEARBY_NSIPS } from '../../nearby-nsips.ts';
import { describeReasons } from '../../reasons.ts';
import type { AddedConsultee, RemovedConsultee } from '../urls.ts';

/**
 * The exported consultee report: a Summary tab, then one tab per high-level group of the rulesets
 * workbook, then Nearby NSIPs. Each consultee goes on the tab of the condition that identified it
 * (a hand-added one, its category's), and each nearby case on Nearby NSIPs, with the columns
 * config/report.yaml sets - its fixed columns, then the metadata each category exports, a column
 * per heading.
 */

/** The tabs after Summary, in order - config/report.yaml sets each one's columns. */
export const GROUP_TABS = REPORT_TABS;

type GroupTab = (typeof GROUP_TABS)[number];

/** A consultee_area row as the database holds it, less its geometries. */
export interface ConsulteeAreaRecord {
	id: string;
	geometryType: string;
	sourceId: string | null;
	consulteeCategory: string | null;
	consulteeGroup: string | null;
	consulteeSubcategory: string | null;
	consulteeSubcategoryDescription: string | null;
	consultee: string | null;
	region: string | null;
	metadata: string;
	lastUpdated: Date;
}

export interface ReportExport {
	caseName: string;
	caseReference: string;
	boundaryFileName: string | null;
	boundaryReceivedDate: Date | null;
	ruleset: Ruleset;
	/** What the run screened - the outline unless said otherwise. */
	siteScreenedAs?: SiteScreenedAs;
	generatedAt: Date;
	/** The consultees the ruleset's conditions identified, less any removed. */
	identified: ConsulteeMatch[];
	/**
	 * Each identified consultee's full row, and each picked nearby one's, by id - a Nearby NSIP's
	 * built from its case_boundary row (see report-zip.ts). Missing only if it was deleted
	 * mid-request.
	 */
	records: Map<string, ConsulteeAreaRecord>;
	/** Consultees added by hand - one the run found with its distance from the site. */
	added: readonly (AddedConsultee & { distanceMetres?: number })[];
	removed: readonly RemovedConsultee[];
}

// the workbook spells its first group "Administative boundaries" - match either spelling
function tabForGroup(group: string | undefined): GroupTab {
	const normalised = (group ?? '').trim().toLowerCase().replace('administative', 'administrative');
	return GROUP_TABS.find((tab) => tab.toLowerCase() === normalised) ?? 'Other';
}

/**
 * The tab a ruleset match goes on: the group of the first condition that identified it - Nearby
 * NSIPs for a nearby case.
 */
export function tabForMatch(match: ConsulteeMatch, ruleset: Ruleset): GroupTab {
	for (const reason of match.reasons) {
		if (reason.type === 'nearbyNsip') {
			return NEARBY_NSIPS;
		}
		if (reason.type === 'condition') {
			const rule = ruleset.rules.find((candidate) => candidate.id === reason.conditionId);
			if (rule) {
				return tabForGroup(rule.group);
			}
		}
	}
	return 'Other';
}

/**
 * The tab a hand-added consultee goes on: the group of the first condition naming its category -
 * Nearby NSIPs for one added there.
 */
export function tabForCategory(category: string, ruleset: Ruleset): GroupTab {
	if (category === NEARBY_NSIPS) {
		return NEARBY_NSIPS;
	}
	return tabForGroup(ruleset.rules.find((rule) => rule.categories.includes(category))?.group);
}

type Cell = SheetData[number][number];

const text = (value: string | null | undefined): Cell => (value ? { value } : null);
const bold = (value: string): Cell => ({ value, fontWeight: 'bold' });
const headerRow = (labels: readonly string[]) => labels.map(bold);

function kilometres(metres: number | null | undefined): Cell {
	return metres === null || metres === undefined
		? null
		: { type: Number, value: Math.round(metres / 10) / 100, format: '0.00' };
}

type Metadata = Record<string, unknown>;

/** A JSON object held as text - as some earlier exports nested their attributes - else undefined. */
function jsonObjectIn(value: unknown): Metadata | undefined {
	if (typeof value !== 'string' || !value.trimStart().startsWith('{')) {
		return undefined;
	}
	try {
		// text starting with { that parses is always an object
		return JSON.parse(value) as Metadata;
	} catch {
		return undefined;
	}
}

function isObject(value: unknown): value is Metadata {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A list as one readable value: its items' text, comma-separated - an object item as "key: value" pairs. */
function listText(items: unknown[]): string {
	return items
		.filter((item) => item !== null && item !== undefined && item !== '')
		.map((item) =>
			isObject(item)
				? Object.entries(flattenMetadata(item))
						.map(([key, value]) => `${key}: ${String(value)}`)
						.join('; ')
				: String(item)
		)
		.join(', ');
}

/**
 * Metadata as one level of readable values: a nested object's attributes under dotted names
 * (area.ha), a list as text, and a JSON object held as text opened up the same way - so no cell
 * of the report shows JSON.
 */
function flattenMetadata(metadata: Metadata, prefix = ''): Metadata {
	const flat: Metadata = {};
	for (const [key, value] of Object.entries(metadata)) {
		const name = prefix ? `${prefix}.${key}` : key;
		const nested = isObject(value) ? value : jsonObjectIn(value);
		if (nested) {
			Object.assign(flat, flattenMetadata(nested, name));
		} else if (Array.isArray(value)) {
			flat[name] = listText(value);
		} else {
			flat[name] = value;
		}
	}
	return flat;
}

/**
 * A stored row's metadata as readable values, by attribute: the source data's own attributes,
 * which differ from one source dataset to another, flattened (see flattenMetadata). A list is kept
 * as text under "Metadata", and anything that isn't JSON whole.
 */
export function parseMetadata(raw: string | undefined): Metadata {
	if (!raw) {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (isObject(parsed)) {
			return flattenMetadata(parsed);
		}
		return { Metadata: Array.isArray(parsed) ? listText(parsed) : raw };
	} catch {
		return { Metadata: raw };
	}
}

/** A metadata value as a cell: numbers and true/false as such, anything else as text. */
function metadataCell(value: unknown): Cell {
	if (value === null || value === undefined || value === '') {
		return null;
	}
	if (typeof value === 'number') {
		return { type: Number, value };
	}
	if (typeof value === 'boolean') {
		return { type: Boolean, value };
	}
	return { value: String(value) };
}

/**
 * The metadata a category exports, by column heading - as config/report.yaml sets for it: every
 * attribute under its own name, none, or the attributes it lists under their headings. Attributes
 * sharing a heading share a column; the first with a value fills it.
 */
export function exportedMetadata(metadata: Metadata, selection: MetadataSelection): Map<string, unknown> {
	if (selection === 'none') {
		return new Map();
	}
	if (selection === 'all') {
		return new Map(Object.entries(metadata));
	}
	const exported = new Map<string, unknown>();
	for (const { attribute, heading } of selection) {
		const value = metadata[attribute];
		if (!exported.has(heading) || metadataCell(exported.get(heading)) === null) {
			exported.set(heading, value);
		}
	}
	return exported;
}

/** One consultee as a row describes it, whichever way it came into the report. */
interface RowSource {
	id: string | undefined;
	name: string | null | undefined;
	category: string | null | undefined;
	region: string | null | undefined;
	whyIdentified: string;
	source: 'Ruleset' | 'Manually added';
	distanceMetres: number | null | undefined;
	/** Its stored row - missing for a consultee added by name alone, or deleted mid-request. */
	record: ConsulteeAreaRecord | undefined;
}

/** Each fixed column's cell - the columns config/report.yaml can choose from. */
const COLUMN_CELLS: Record<ReportColumn, (row: RowSource) => Cell> = {
	consultee: (row) => text(row.name),
	category: (row) => text(row.category),
	region: (row) => text(row.region),
	whyIdentified: (row) => ({ value: row.whyIdentified, wrap: true }),
	source: (row) => ({ value: row.source }),
	group: (row) => text(row.record?.consulteeGroup),
	subcategory: (row) => text(row.record?.consulteeSubcategory),
	subcategoryDescription: (row) =>
		row.record?.consulteeSubcategoryDescription
			? { value: row.record.consulteeSubcategoryDescription, wrap: true }
			: null,
	distanceKm: (row) => kilometres(row.distanceMetres),
	consulteeAreaId: (row) => text(row.id),
	sourceId: (row) => text(row.record?.sourceId),
	geometryType: (row) => text(row.record?.geometryType),
	lastUpdated: (row) => (row.record ? { type: Date, value: row.record.lastUpdated, format: 'yyyy-mm-dd hh:mm' } : null)
};

export const COLUMN_WIDTHS: Record<ReportColumn, number> = {
	consultee: 36,
	category: 28,
	region: 22,
	whyIdentified: 60,
	source: 16,
	group: 22,
	subcategory: 22,
	subcategoryDescription: 40,
	distanceKm: 12,
	consulteeAreaId: 38,
	sourceId: 30,
	geometryType: 16,
	lastUpdated: 18
};

interface SortableRow {
	category: string;
	name: string;
	cells: Cell[];
	metadata: Map<string, unknown>;
}

function byCategoryThenName(a: SortableRow, b: SortableRow): number {
	return a.category.localeCompare(b.category, 'en-GB') || a.name.localeCompare(b.name, 'en-GB');
}

/** One group tab: its columns (the fixed ones, then its metadata headings) and a row per consultee. */
interface GroupTabContent {
	header: string[];
	widths: number[];
	rows: Cell[][];
}

/**
 * Every metadata heading the tab's consultees export, in the order they first appear - a column
 * each. A consultee without one leaves that cell blank.
 */
function metadataColumns(rows: SortableRow[]): string[] {
	const headings = new Set<string>();
	for (const row of rows) {
		for (const heading of row.metadata.keys()) {
			headings.add(heading);
		}
	}
	return [...headings];
}

function tabContent(rows: SortableRow[], columns: readonly ReportColumn[]): GroupTabContent {
	const sorted = rows.sort(byCategoryThenName);
	const headings = metadataColumns(sorted);
	return {
		header: [...columns.map((column) => REPORT_COLUMNS[column]), ...headings],
		widths: [
			...columns.map((column) => COLUMN_WIDTHS[column]),
			...headings.map((heading) => Math.min(40, Math.max(12, heading.length + 2)))
		],
		rows: sorted.map((row) => [...row.cells, ...headings.map((heading) => metadataCell(row.metadata.get(heading)))])
	};
}

/** A consultee's row on `tab`: the tab's fixed columns, then the metadata its category exports. */
function sortableRow(source: RowSource, tab: GroupTab, config: ReportConfig): SortableRow {
	return {
		category: source.category ?? '',
		name: source.name ?? '',
		cells: tabSettings(tab, config).columns.map((column) => COLUMN_CELLS[column](source)),
		metadata: exportedMetadata(
			parseMetadata(source.record?.metadata),
			categorySettings(source.category, config).metadata
		)
	};
}

function groupTabs(report: ReportExport, config: ReportConfig): Map<GroupTab, GroupTabContent> {
	const rows = new Map<GroupTab, SortableRow[]>(GROUP_TABS.map((tab) => [tab, []]));
	for (const match of report.identified) {
		const record = report.records.get(match.feature.id);
		const properties = match.feature.properties;
		const tab = tabForMatch(match, report.ruleset);
		rows.get(tab)!.push(
			sortableRow(
				{
					id: match.feature.id,
					// the stored row's values win over the run's
					name: record?.consultee ?? properties.consultee,
					category: record?.consulteeCategory ?? properties.consulteeCategory,
					region: record?.region ?? properties.region,
					whyIdentified: describeReasons(match, report.ruleset, { nearby: false }).join('\n'),
					source: 'Ruleset',
					distanceMetres: match.distanceMetres,
					record
				},
				tab,
				config
			)
		);
	}
	for (const add of report.added) {
		// one from before additions had to be real consultees may have no stored row
		const record = add.id ? report.records.get(add.id) : undefined;
		const tab = tabForCategory(add.category, report.ruleset);
		rows.get(tab)!.push(
			sortableRow(
				{
					id: add.id,
					name: add.name,
					category: add.category,
					region: record?.region,
					whyIdentified: add.reason || 'Manually added',
					source: 'Manually added',
					distanceMetres: add.distanceMetres,
					record
				},
				tab,
				config
			)
		);
	}
	return new Map([...rows].map(([tab, tabRows]) => [tab, tabContent(tabRows, tabSettings(tab, config).columns)]));
}

/** A date as the report writes it: "6 July 2026". */
export function formatDate(date: Date): string {
	return date.toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'Europe/London'
	});
}

function summarySheet(report: ReportExport, tabs: Map<GroupTab, GroupTabContent>): SheetData {
	const detail = (label: string, value: string | null): Cell[] => [bold(label), text(value)];
	const sheet: SheetData = [
		[{ value: 'Consultee report', fontWeight: 'bold', fontSize: 16 }],
		[],
		detail('Project', report.caseName),
		detail('Case reference', report.caseReference),
		detail('Boundary file', report.boundaryFileName),
		detail('Boundary received', report.boundaryReceivedDate ? formatDate(report.boundaryReceivedDate) : null),
		detail('Ruleset', report.ruleset.name),
		detail(
			'Screened against',
			report.siteScreenedAs === 'boundingBox'
				? "The site's bounding box - its outline was too detailed to screen in time, so the list can include consultees that aren't near the site"
				: "The site's outline"
		),
		[bold('Generated'), { type: Date, value: report.generatedAt, format: 'd mmmm yyyy hh:mm' }],
		[],
		headerRow(['Tab', 'Consultees']),
		...GROUP_TABS.map((tab): Cell[] => [{ value: tab }, { type: Number, value: tabs.get(tab)!.rows.length }]),
		[bold('Total'), { type: Number, value: report.identified.length + report.added.length, fontWeight: 'bold' }],
		[],
		detail('Identified by the ruleset', String(report.identified.length)),
		detail('Manually added', String(report.added.length)),
		detail('Removed', String(report.removed.length))
	];
	if (report.removed.length > 0) {
		sheet.push([], [bold('Removed consultees')], headerRow(['Consultee', 'Category', 'Reason']));
		for (const removal of report.removed) {
			sheet.push([text(removal.name), text(removal.category), { value: removal.reason, wrap: true }]);
		}
	}
	return sheet;
}

/** The workbook's sheets, ready for write-excel-file: Summary, the five group tabs, then Nearby NSIPs. */
export function buildReportSheets(report: ReportExport, config: ReportConfig = REPORT_CONFIG) {
	const tabs = groupTabs(report, config);
	return [
		{ sheet: 'Summary', data: summarySheet(report, tabs), columns: [{ width: 28 }, { width: 50 }, { width: 60 }] },
		...GROUP_TABS.map((tab) => {
			const { header, widths, rows } = tabs.get(tab)!;
			return {
				sheet: tab,
				data: [headerRow(header), ...rows] as SheetData,
				columns: widths.map((width) => ({ width })),
				stickyRowsCount: 1
			};
		})
	];
}

/** `name` without the characters file systems reject. */
export function safeFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|]+/g, '-');
}

/**
 * The download's file names - the workbook, or the ZIP holding it and the maps: reference, ruleset
 * and date, without characters file systems reject.
 */
export function reportFileName(
	report: Pick<ReportExport, 'caseReference' | 'ruleset' | 'generatedAt'>,
	extension: 'xlsx' | 'zip' = 'xlsx'
): string {
	const date = report.generatedAt.toISOString().slice(0, 10);
	const kind = extension === 'zip' ? 'consultee report' : 'consultees';
	return safeFileName(`${report.caseReference} ${report.ruleset.name} ${kind} ${date}.${extension}`);
}
