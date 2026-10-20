import type { ConsulteeMatch, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { SheetData } from 'write-excel-file/node';
import type { MetadataSelection, ReportColumn, ReportConfig } from '../../../../report-config.ts';
import { categorySettings, REPORT_COLUMNS, REPORT_CONFIG } from '../../../../report-config.ts';
import { describeReasons } from '../../reasons.ts';
import type { AddedConsultee, RemovedConsultee } from '../urls.ts';

/**
 * The exported consultee report: a Summary tab, then one tab per high-level group of the rulesets
 * workbook. Each consultee goes on the tab of the condition that identified it (a hand-added one,
 * its category's), with the columns config/report.yaml sets - its fixed columns, then the metadata
 * each category exports, a column per heading.
 */

/** The tabs after Summary, in order. "Other Cases" is a placeholder - nothing fills it yet. */
export const GROUP_TABS = ['Administrative boundaries', 'Public bodies', 'Energy', 'Transport', 'Other'] as const;
export const OTHER_CASES_TAB = 'Other Cases';

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
	generatedAt: Date;
	/** The consultees the ruleset's conditions identified, less any removed. */
	identified: ConsulteeMatch[];
	/**
	 * Each identified consultee's full row, and each picked nearby one's, by id - missing only if it
	 * was deleted mid-request.
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

/** The tab a ruleset match goes on: the group of the first condition that identified it. */
export function tabForMatch(match: ConsulteeMatch, ruleset: Ruleset): GroupTab {
	for (const reason of match.reasons) {
		if (reason.type === 'condition') {
			const rule = ruleset.rules.find((candidate) => candidate.id === reason.conditionId);
			if (rule) {
				return tabForGroup(rule.group);
			}
		}
	}
	return 'Other';
}

/** The tab a hand-added consultee goes on: the group of the first condition naming its category. */
export function tabForCategory(category: string, ruleset: Ruleset): GroupTab {
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

/**
 * A stored row's metadata as an object: the source data's own attributes, which differ from one
 * source dataset to another. Anything that isn't a JSON object is kept whole, under "Metadata".
 */
export function parseMetadata(raw: string | undefined): Metadata {
	if (!raw) {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Metadata)
			: { Metadata: raw };
	} catch {
		return { Metadata: raw };
	}
}

/** A metadata value as a cell: numbers and true/false as such, objects and lists as JSON. */
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
	return { value: typeof value === 'string' ? value : JSON.stringify(value) };
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

function sortableRow(source: RowSource, config: ReportConfig): SortableRow {
	return {
		category: source.category ?? '',
		name: source.name ?? '',
		cells: config.columns.map((column) => COLUMN_CELLS[column](source)),
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
		rows.get(tabForMatch(match, report.ruleset))!.push(
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
				config
			)
		);
	}
	for (const add of report.added) {
		// one from before additions had to be real consultees may have no stored row
		const record = add.id ? report.records.get(add.id) : undefined;
		rows.get(tabForCategory(add.category, report.ruleset))!.push(
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
				config
			)
		);
	}
	return new Map([...rows].map(([tab, tabRows]) => [tab, tabContent(tabRows, config.columns)]));
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

/** The workbook's sheets, ready for write-excel-file: Summary, the five group tabs, then Other Cases. */
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
		}),
		{
			sheet: OTHER_CASES_TAB,
			data: [[bold('Other cases')], [{ value: 'Not filled yet.' }]] as SheetData,
			columns: [{ width: 40 }]
		}
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
