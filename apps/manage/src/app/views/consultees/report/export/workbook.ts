import type { ConsulteeMatch, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { SheetData } from 'write-excel-file/node';
import { describeReasons } from '../../reasons.ts';
import type { AddedConsultee, RemovedConsultee } from '../urls.ts';

/**
 * The exported consultee report: a Summary tab, then one tab per high-level group of the rulesets
 * workbook. Each consultee goes on the tab of the condition that identified it (a hand-added one,
 * its category's), with its consultee_area columns - less the geometries and the ids and version the
 * reference data leaves empty - and its metadata spread into a column per attribute.
 */

/** The tabs after Summary, in order. "Other Cases" is a placeholder - nothing fills it yet. */
export const GROUP_TABS = ['Administrative boundaries', 'Public bodies', 'Energy', 'Transport', 'Other'] as const;
export const OTHER_CASES_TAB = 'Other Cases';

type GroupTab = (typeof GROUP_TABS)[number];

/** A consultee_area row as the database holds it, less its geometries. */
export interface ConsulteeAreaRecord {
	id: string;
	geometryType: string;
	consulteeCategory: string | null;
	consultee: string | null;
	region: string | null;
	caseReference: string | null;
	documentId: string | null;
	consulteeId: string | null;
	organisationId: string | null;
	currentVersion: number;
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
	/** Consultees added by hand - a picked nearby one with its distance from the site. */
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

// every tab's first columns - then the metadata keys its consultees have (see metadataColumns)
const HEADER = [
	'Consultee',
	'Category',
	'Region',
	'Why identified',
	'Distance from site (km)',
	'Consultee area id',
	'Geometry type',
	'Case reference',
	'Last updated'
] as const;

export const GROUP_TAB_COLUMN_WIDTHS = [36, 28, 22, 60, 12, 38, 16, 14, 18];

type Cell = SheetData[number][number];

const text = (value: string | null | undefined): Cell => (value ? { value } : null);
const bold = (value: string): Cell => ({ value, fontWeight: 'bold' });
const headerRow = (labels: readonly string[]) => labels.map(bold);

function kilometres(metres: number | null): Cell {
	return metres === null ? null : { type: Number, value: Math.round(metres / 10) / 100, format: '0.00' };
}

type Metadata = Record<string, unknown>;

/**
 * A stored row's metadata as an object: the data's own attributes, which differ from one source
 * dataset to another. Anything that isn't a JSON object is kept whole, under "Metadata".
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

// the stored row's columns after the area id - blank when there's no stored row
function storedCells(record: ConsulteeAreaRecord | undefined): Cell[] {
	return [
		text(record?.geometryType),
		text(record?.caseReference),
		record ? { type: Date, value: record.lastUpdated, format: 'yyyy-mm-dd hh:mm' } : null
	];
}

function matchRow(match: ConsulteeMatch, ruleset: Ruleset, record: ConsulteeAreaRecord | undefined): Cell[] {
	const properties = match.feature.properties;
	return [
		text(record?.consultee ?? properties.consultee),
		text(record?.consulteeCategory ?? properties.consulteeCategory),
		text(record?.region ?? properties.region),
		{ value: describeReasons(match, ruleset, { nearby: false }).join('\n'), wrap: true },
		kilometres(match.distanceMetres),
		{ value: match.feature.id },
		...storedCells(record)
	];
}

// a matched nearby consultee has its stored row and distance; any other name has neither
function addedRow(add: ReportExport['added'][number], record: ConsulteeAreaRecord | undefined): Cell[] {
	return [
		{ value: add.name },
		{ value: add.category },
		text(record?.region),
		{ value: add.reason ? `Added by hand: ${add.reason}` : 'Added by hand', wrap: true },
		kilometres(add.distanceMetres ?? null),
		text(add.id),
		...storedCells(record)
	];
}

interface SortableRow {
	category: string;
	name: string;
	cells: Cell[];
	metadata: Metadata;
}

function byCategoryThenName(a: SortableRow, b: SortableRow): number {
	return a.category.localeCompare(b.category, 'en-GB') || a.name.localeCompare(b.name, 'en-GB');
}

/** One group tab: its columns (the fixed ones, then its metadata keys) and a row per consultee. */
interface GroupTabContent {
	header: string[];
	widths: number[];
	rows: Cell[][];
}

/**
 * Every metadata key the tab's consultees have, in the order they first appear - a column each.
 * A consultee without one leaves that cell blank.
 */
function metadataColumns(rows: SortableRow[]): string[] {
	const keys = new Set<string>();
	for (const row of rows) {
		for (const key of Object.keys(row.metadata)) {
			keys.add(key);
		}
	}
	return [...keys];
}

function tabContent(rows: SortableRow[]): GroupTabContent {
	const sorted = rows.sort(byCategoryThenName);
	const keys = metadataColumns(sorted);
	return {
		header: [...HEADER, ...keys],
		widths: [...GROUP_TAB_COLUMN_WIDTHS, ...keys.map((key) => Math.min(40, Math.max(12, key.length + 2)))],
		rows: sorted.map((row) => [...row.cells, ...keys.map((key) => metadataCell(row.metadata[key]))])
	};
}

function groupTabs(report: ReportExport): Map<GroupTab, GroupTabContent> {
	const rows = new Map<GroupTab, SortableRow[]>(GROUP_TABS.map((tab) => [tab, []]));
	for (const match of report.identified) {
		const record = report.records.get(match.feature.id);
		rows.get(tabForMatch(match, report.ruleset))!.push({
			category: record?.consulteeCategory ?? match.feature.properties.consulteeCategory ?? '',
			name: record?.consultee ?? match.feature.properties.consultee ?? '',
			cells: matchRow(match, report.ruleset, record),
			metadata: parseMetadata(record?.metadata)
		});
	}
	for (const add of report.added) {
		const record = add.id ? report.records.get(add.id) : undefined;
		rows.get(tabForCategory(add.category, report.ruleset))!.push({
			category: add.category,
			name: add.name,
			cells: addedRow(add, record),
			metadata: parseMetadata(record?.metadata)
		});
	}
	return new Map([...rows].map(([tab, tabRows]) => [tab, tabContent(tabRows)]));
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
		detail('Added by hand', String(report.added.length)),
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
export function buildReportSheets(report: ReportExport) {
	const tabs = groupTabs(report);
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
