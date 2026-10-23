import type {
	ConsulteeMatch,
	ConsulteeReason,
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
	summaryLines,
	tabSettings
} from '../../../../report-config.ts';
import { isNearbyNsip, NEARBY_NSIPS, nsipType, splitNsipName } from '../../nearby-nsips.ts';
import { describeReasons, kilometres as distanceText } from '../../reasons.ts';
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
/** An empty cell for someone to fill in: yellow, and boxed, so it stands out. */
const TO_FILL_IN: Cell = { value: '', backgroundColor: '#FFDD00', borderStyle: 'thin', borderColor: '#0B0C0C' };
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
	/** The nearest buffer a condition found it within, in km - none for one added by hand. */
	bufferKm?: number;
	/** An NSIP's own fields (see nsipFields) - its tab's metadata. */
	nsip?: Metadata;
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

const COLUMN_WIDTHS: Record<ReportColumn, number> = {
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
	bufferKm?: number;
	cells: Cell[];
	metadata: Map<string, unknown>;
}

function byCategoryThenName(a: SortableRow, b: SortableRow): number {
	return a.category.localeCompare(b.category, 'en-GB') || a.name.localeCompare(b.name, 'en-GB');
}

/** What the Summary counts a consultee by: its category, and the nearest buffer a condition found it within. */
export interface CountedConsultee {
	category: string;
	bufferKm?: number;
}

/**
 * One group tab: its columns (the fixed ones, then its metadata headings), a row per consultee, and
 * what the Summary tab counts each by.
 */
interface GroupTabContent {
	header: string[];
	widths: number[];
	rows: Cell[][];
	counted: CountedConsultee[];
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
		rows: sorted.map((row) => [...row.cells, ...headings.map((heading) => metadataCell(row.metadata.get(heading)))]),
		counted: sorted.map(({ category, bufferKm }) => ({ category, bufferKm }))
	};
}

/** A consultee's row on `tab`: the tab's fixed columns, then the metadata its category exports. */
function sortableRow(source: RowSource, tab: GroupTab, config: ReportConfig): SortableRow {
	return {
		category: source.category ?? '',
		name: source.name ?? '',
		bufferKm: source.bufferKm,
		cells: tabSettings(tab, config).columns.map((column) => COLUMN_CELLS[column](source)),
		metadata: exportedMetadata(
			{ ...parseMetadata(source.record?.metadata), ...source.nsip },
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
					record,
					bufferKm: nearestBufferKm(match, report.ruleset),
					...(tab === NEARBY_NSIPS ? { nsip: nsipFields(properties.consultee ?? '', nsipQuery(match)) } : {})
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
					record,
					...(tab === NEARBY_NSIPS ? { nsip: nsipFields(add.name, add.reason) } : {})
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

/**
 * A tab's lines on the Summary tab, with their counts: config/report.yaml's lines for it, in order,
 * each shown even at 0 - each consultee counted on the first line for its category (and, for a line
 * split by buffer, its nearest buffer) - then any consultee no line counts, under its category's own
 * name, so the lines add up to the tab's total.
 */
function summaryCounts(
	tab: GroupTab,
	counted: CountedConsultee[],
	config: ReportConfig = REPORT_CONFIG
): { label: string; count: number }[] {
	const left = [...counted];
	const take = (matches: (consultee: CountedConsultee) => boolean): CountedConsultee[] => {
		const taken = left.filter(matches);
		left.splice(0, left.length, ...left.filter((consultee) => !matches(consultee)));
		return taken;
	};
	const lines = summaryLines(tab, config).map(({ label, categories, bufferKm }) => ({
		label,
		count: take(
			(consultee) =>
				categories.includes(consultee.category) && (bufferKm === undefined || consultee.bufferKm === bufferKm)
		).length
	}));
	const rest = Map.groupBy(left, (consultee) => consultee.category);
	return [
		...lines,
		...[...rest]
			.toSorted(([a], [b]) => a.localeCompare(b, 'en-GB'))
			.map(([category, consultees]) => ({ label: category || 'No category', count: consultees.length }))
	];
}

/**
 * `date` as a clock in the UK shows it, for a spreadsheet cell: Excel has no time zones, and is
 * written a date's UTC fields - an hour behind in British Summer Time.
 */
export function ukClockTime(date: Date): Date {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-GB', {
			timeZone: 'Europe/London',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric',
			hourCycle: 'h23'
		})
			.formatToParts(date)
			.map(({ type, value }) => [type, Number(value)])
	);
	return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
}

function count(value: number, fontWeight?: 'bold'): Cell {
	return { type: Number, value, ...(fontWeight ? { fontWeight } : {}) };
}

/** A list of consultees added or removed, under its heading - a table of none when there are none. */
function consulteeList(heading: string, consultees: readonly { name: string; category: string; reason: string }[]) {
	return [
		[bold(heading)],
		headerRow(['Consultee', 'Category', 'Reason']),
		...consultees.map((consultee): Cell[] => [
			text(consultee.name),
			text(consultee.category),
			{ value: consultee.reason, wrap: true }
		])
	];
}

/** An NSIP's own fields, in order - the NSIPs tab's metadata and the Summary's list's columns. */
const NSIP_FIELDS = ['Name', 'Number', 'Type', 'Sub-type', 'Query'] as const;

/** The query that found a Nearby NSIP - the buffer it's within, "35km buffer". */
function nsipQuery(match: ConsulteeMatch): string {
	return match.reasons
		.filter((reason): reason is Extract<ConsulteeReason, { type: 'nearbyNsip' }> => reason.type === 'nearbyNsip')
		.map((reason) => `${distanceText(reason.radiusMetres)} buffer`)
		.join('\n');
}

/**
 * An NSIP's own fields (NSIP_FIELDS): its project name and case reference from the name it's listed
 * under, its type and sub-type from that reference (see nsipType), and `query` - how it was found,
 * or the reason given for adding it.
 */
function nsipFields(name: string, query: string): Metadata {
	const { projectName, caseReference } = splitNsipName(name);
	const { type, subType } = nsipType(caseReference);
	return { Name: projectName, Number: caseReference ?? null, Type: type, 'Sub-type': subType, Query: query };
}

/**
 * The nearest buffer, in km, of the conditions that found a consultee - none if no buffer condition
 * did. The Summary splits a category by it where config/report.yaml says to.
 */
export function nearestBufferKm(match: ConsulteeMatch, ruleset: Ruleset): number | undefined {
	const buffers = match.reasons.flatMap((reason) =>
		reason.type === 'condition'
			? ruleset.rules
					.filter((rule) => rule.id === reason.conditionId && rule.logicType === 'intersection')
					.map((rule) => (rule.bufferMetres ?? 0) / 1000)
			: []
	);
	return buffers.length > 0 ? Math.min(...buffers) : undefined;
}

/**
 * The Summary's list of national infrastructure projects - the report's NSIPs: those found, nearest
 * first, then those added by hand - each with its own fields (see nsipFields).
 */
function nsipList(report: ReportExport): Cell[][] {
	const nsips = [
		...report.identified
			.filter(isNearbyNsip)
			.map((match) => nsipFields(match.feature.properties.consultee ?? '', nsipQuery(match))),
		...report.added.filter((add) => add.category === NEARBY_NSIPS).map((add) => nsipFields(add.name, add.reason))
	];
	return [
		[bold('List of National infrastructure projects')],
		headerRow(NSIP_FIELDS),
		...nsips.map((fields): Cell[] =>
			NSIP_FIELDS.map((field) =>
				field === 'Query' ? { value: String(fields.Query), wrap: true } : text(fields[field] as string | null)
			)
		)
	];
}

function summarySheet(report: ReportExport, tabs: Map<GroupTab, GroupTabContent>, config: ReportConfig): SheetData {
	const detail = (label: string, value: string | null | undefined): Cell[] => [bold(label), text(value)];
	const tabLines = GROUP_TABS.flatMap((tab): Cell[][] => {
		const { rows, counted } = tabs.get(tab)!;
		const lines = summaryCounts(tab, counted, config);
		// Nearby NSIPs are one category, so their line is their tab's total
		if (tab === NEARBY_NSIPS) {
			return lines.map(({ label, count: value }) => [bold(label), count(value, 'bold')]);
		}
		return [
			[bold(`${tab} - Total`), count(rows.length, 'bold')],
			...lines.map(({ label, count: value }): Cell[] => [{ value: label, indent: 1 }, count(value)])
		];
	});
	return [
		[{ value: 'Consultee report', fontWeight: 'bold', fontSize: 16 }],
		[],
		detail('Project', report.caseName),
		detail('Case reference', report.caseReference),
		detail('Boundary file', report.boundaryFileName),
		detail('Boundary received', report.boundaryReceivedDate ? formatDate(report.boundaryReceivedDate) : null),
		detail('Ruleset', report.ruleset.name),
		// said only when it matters: the list can include consultees that aren't near the site
		...(report.siteScreenedAs === 'boundingBox'
			? [
					detail(
						'Screened against',
						"The site's bounding box - its outline was too detailed to screen in time, so the list can include consultees that aren't near the site"
					)
				]
			: []),
		[
			bold('Report generated date'),
			{ type: Date, value: ukClockTime(report.generatedAt), format: 'd mmmm yyyy hh:mm' }
		],
		// left for whoever sends the report to fill in - highlighted so it isn't missed
		[bold('Report generated by'), TO_FILL_IN],
		[],
		headerRow(['Tab', 'Consultees']),
		...tabLines,
		[],
		[bold('Total'), count(report.identified.length + report.added.length, 'bold')],
		[],
		[bold('Identified by the ruleset'), count(report.identified.length)],
		[bold('Manually added'), count(report.added.length)],
		[bold('Removed'), count(report.removed.length)],
		[],
		...consulteeList('Added consultees', report.added),
		[],
		...consulteeList('Removed consultees', report.removed),
		[],
		...nsipList(report)
	];
}

/** The workbook's sheets, ready for write-excel-file: Summary, the five group tabs, then Nearby NSIPs. */
export function buildReportSheets(report: ReportExport, config: ReportConfig = REPORT_CONFIG) {
	const tabs = groupTabs(report, config);
	return [
		{
			sheet: 'Summary',
			data: summarySheet(report, tabs, config),
			columns: [{ width: 64 }, { width: 50 }, { width: 60 }, { width: 34 }, { width: 14 }]
		},
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
