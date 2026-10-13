import type { ConsulteeMatch, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { SheetData } from 'write-excel-file/node';
import { describeReasons } from '../../reasons.ts';
import type { AddedConsultee, RemovedConsultee } from '../urls.ts';

/**
 * The exported consultee report: a Summary tab, then one tab per high-level group of the rulesets
 * workbook. Each consultee goes on the tab of the condition that identified it (a hand-added one,
 * its category's), with every column consultee_area holds except the geometries.
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

const HEADER = [
	'Consultee',
	'Category',
	'Region',
	'Why identified',
	'Distance from site (km)',
	'Source',
	'Consultee area id',
	'Geometry type',
	'Case reference',
	'Document id',
	'Consultee id',
	'Organisation id',
	'Current version',
	'Last updated',
	'Metadata (JSON)'
] as const;

export const GROUP_TAB_COLUMN_WIDTHS = [36, 28, 22, 60, 12, 16, 38, 16, 14, 38, 38, 38, 10, 20, 80];

type Cell = SheetData[number][number];

const text = (value: string | null | undefined): Cell => (value ? { value } : null);
const bold = (value: string): Cell => ({ value, fontWeight: 'bold' });
const headerRow = (labels: readonly string[]) => labels.map(bold);

function kilometres(metres: number | null): Cell {
	return metres === null ? null : { type: Number, value: Math.round(metres / 10) / 100, format: '0.00' };
}

// the stored row's columns after the area id - blank when there's no stored row
function storedCells(record: ConsulteeAreaRecord | undefined): Cell[] {
	return [
		text(record?.geometryType),
		text(record?.caseReference),
		text(record?.documentId),
		text(record?.consulteeId),
		text(record?.organisationId),
		record ? { type: Number, value: record.currentVersion } : null,
		record ? { type: Date, value: record.lastUpdated, format: 'yyyy-mm-dd hh:mm' } : null,
		text(record?.metadata)
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
		{ value: 'Ruleset' },
		{ value: match.feature.id },
		...storedCells(record)
	];
}

// a picked nearby consultee has its stored row and distance; one typed in by name has neither
function addedRow(add: ReportExport['added'][number], record: ConsulteeAreaRecord | undefined): Cell[] {
	return [
		{ value: add.name },
		{ value: add.category },
		text(record?.region),
		{ value: add.reason || 'Manually added', wrap: true },
		kilometres(add.distanceMetres ?? null),
		{ value: 'Added by hand' },
		text(add.id),
		...storedCells(record)
	];
}

interface SortableRow {
	category: string;
	name: string;
	cells: Cell[];
}

function byCategoryThenName(a: SortableRow, b: SortableRow): number {
	return a.category.localeCompare(b.category, 'en-GB') || a.name.localeCompare(b.name, 'en-GB');
}

function groupTabs(report: ReportExport): Map<GroupTab, Cell[][]> {
	const rows = new Map<GroupTab, SortableRow[]>(GROUP_TABS.map((tab) => [tab, []]));
	for (const match of report.identified) {
		const record = report.records.get(match.feature.id);
		rows.get(tabForMatch(match, report.ruleset))!.push({
			category: record?.consulteeCategory ?? match.feature.properties.consulteeCategory ?? '',
			name: record?.consultee ?? match.feature.properties.consultee ?? '',
			cells: matchRow(match, report.ruleset, record)
		});
	}
	for (const add of report.added) {
		rows.get(tabForCategory(add.category, report.ruleset))!.push({
			category: add.category,
			name: add.name,
			cells: addedRow(add, add.id ? report.records.get(add.id) : undefined)
		});
	}
	return new Map([...rows].map(([tab, tabRows]) => [tab, tabRows.sort(byCategoryThenName).map((row) => row.cells)]));
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

function summarySheet(report: ReportExport, tabs: Map<GroupTab, Cell[][]>): SheetData {
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
		...GROUP_TABS.map((tab): Cell[] => [{ value: tab }, { type: Number, value: tabs.get(tab)!.length }]),
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
		...GROUP_TABS.map((tab) => ({
			sheet: tab,
			data: [headerRow(HEADER), ...tabs.get(tab)!] as SheetData,
			columns: GROUP_TAB_COLUMN_WIDTHS.map((width) => ({ width })),
			stickyRowsCount: 1
		})),
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
