import type { PrismaClient } from '../client/client.ts';
import { Prisma } from '../client/client.ts';
import { loadConsulteeAreas } from '../geospatial/consultee-areas.ts';
import type { ImportOptions } from './geojson-import.ts';
import { clearExistingRows, importFile, toConsulteeArea } from './geojson-import.ts';
import type { ReferenceDataConfig, ReferenceDataGroup } from './reference-data.ts';
import { groupBySlug, groupForCategory, REFERENCE_DATA_CONFIG } from './reference-data.ts';

/**
 * The reference data, a group at a time. The pipeline writes a file per group of
 * config/reference-data.yaml - the report's five tabs - named for the date its data is from:
 * 20261020_public_bodies.geojson. Loading one replaces just that group's rows: its categories'.
 *
 * In production there's one dataset per quarter. Loading a group's data from a later quarter than
 * the one loaded first moves the group's rows to consultee_area_archive, labelled with their
 * quarter; the same quarter's data just replaces them, so a corrected file can be loaded again.
 * Each load is logged in reference_data_load, which is how the next one knows the quarter.
 */

// A group's rows can be whole national-scale shapes - Public bodies' 316 areas are over 200MB of
// coastline and county boundaries - so its statements move little at a time: a few rows per
// delete or archive, and a few megabytes of source per MERGE (a single larger shape goes alone).
// Each is then short even on Dev's Basic tier, rather than one that runs for minutes.
const GROUP_ROWS_PER_STATEMENT = 25;
const GROUP_CHUNK_CHARACTERS = 4 * 1024 * 1024;

// a group's file: the date its data is from, then the group
const GROUP_BLOB_NAME = /^(\d{4})(\d{2})(\d{2})_([a-z0-9_]+)\.geojson$/;

/** `YYYY-MM-DD` as a date, if it is a real one. */
function isRealDate(isoDate: string): boolean {
	const date = new Date(`${isoDate}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === isoDate;
}

/** A day, month and year - as a form gives them - as YYYY-MM-DD, if they're a real date. */
export function isoDate(day: unknown, month: unknown, year: unknown): string | undefined {
	const parts = [year, month, day].map((part) => String(part ?? '').trim());
	if (!/^\d{4}$/.test(parts[0]) || !/^\d{1,2}$/.test(parts[1]) || !/^\d{1,2}$/.test(parts[2])) {
		return undefined;
	}
	const date = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
	return isRealDate(date) ? date : undefined;
}

/** The date a file's name starts with, as the pipeline names its files (20261020_...), as YYYY-MM-DD. */
export function dateFromFileName(name: string): string | undefined {
	const match = /^(\d{4})(\d{2})(\d{2})/.exec(name);
	return match ? isoDate(match[3], match[2], match[1]) : undefined;
}

/** The file a group's data from `dataDate` (YYYY-MM-DD) is uploaded as: 20261020_public_bodies.geojson. */
export function groupBlobName(group: ReferenceDataGroup, dataDate: string): string {
	return `${dataDate.replaceAll('-', '')}_${group.slug}.geojson`;
}

/** A group file's group and the date its data is from (YYYY-MM-DD), if its name is one. */
export function parseGroupBlobName(
	name: string,
	config: ReferenceDataConfig = REFERENCE_DATA_CONFIG
): { group: ReferenceDataGroup; dataDate: string } | undefined {
	const match = GROUP_BLOB_NAME.exec(name);
	const group = match ? groupBySlug(match[4], config) : undefined;
	if (!match || !group) {
		return undefined;
	}
	const dataDate = `${match[1]}-${match[2]}-${match[3]}`;
	return isRealDate(dataDate) ? { group, dataDate } : undefined;
}

/** The quarter a date (YYYY-MM-DD) is in: 2026-10-20 → 2026-Q4. */
export function quarterOf(dataDate: string): string {
	return `${dataDate.slice(0, 4)}-Q${Math.ceil(Number(dataDate.slice(5, 7)) / 3)}`;
}

/** A group load refused before anything was changed - its message says why. */
export class GroupLoadError extends Error {}

/** What loading a group did. */
export interface GroupLoad {
	group: ReferenceDataGroup;
	quarter: string;
	rowsLoaded: number;
	/** Rows moved to consultee_area_archive, and the quarter they were from - when a new quarter's data came in. */
	rowsArchived: number;
	archivedQuarter?: string;
}

/** A group's latest load, from reference_data_load. */
export interface LatestGroupLoad {
	blobName: string;
	dataDate: Date;
	quarter: string;
	rowsLoaded: number;
	rowsArchived: number;
	loadedAt: Date;
}

function categoriesOf(group: ReferenceDataGroup): Prisma.Sql {
	return Prisma.join([...group.categories]);
}

/** How many of the group's rows consultee_area holds. */
async function groupRowCount(dbClient: PrismaClient, group: ReferenceDataGroup): Promise<number> {
	const [{ count }] = await dbClient.$queryRaw<{ count: number }[]>`
		SELECT COUNT(*) AS count FROM consultee_area WHERE consulteeCategory IN (${categoriesOf(group)})
	`;
	return count;
}

/**
 * Move the group's rows to consultee_area_archive, labelled `quarter`, a batch at a time - each
 * batch deleted and archived in one statement, so a row is never in both tables, or neither.
 */
async function archiveGroupRows(dbClient: PrismaClient, group: ReferenceDataGroup, quarter: string): Promise<number> {
	let total = 0;
	for (;;) {
		const moved = await dbClient.$executeRaw`
			DELETE TOP (${GROUP_ROWS_PER_STATEMENT}) FROM consultee_area
			OUTPUT DELETED.id, ${quarter}, DELETED.geometry, DELETED.geometryType, DELETED.sourceId,
				DELETED.consulteeCategory, DELETED.consulteeGroup, DELETED.consulteeSubcategory,
				DELETED.consulteeSubcategoryDescription, DELETED.consultee, DELETED.region, DELETED.metadata,
				DELETED.currentVersion, DELETED.validFrom, DELETED.validTo, DELETED.lastUpdated
			INTO consultee_area_archive (
				consulteeAreaId, quarter, geometry, geometryType, sourceId, consulteeCategory, consulteeGroup,
				consulteeSubcategory, consulteeSubcategoryDescription, consultee, region, metadata,
				currentVersion, validFrom, validTo, lastUpdated
			)
			WHERE consulteeCategory IN (${categoriesOf(group)})
		`;
		total += moved;
		if (moved < GROUP_ROWS_PER_STATEMENT) {
			return total;
		}
	}
}

/** Delete the group's rows, a batch at a time. */
async function deleteGroupRows(dbClient: PrismaClient, group: ReferenceDataGroup): Promise<number> {
	let total = 0;
	for (;;) {
		const deleted = await dbClient.$executeRaw`
			DELETE TOP (${GROUP_ROWS_PER_STATEMENT}) FROM consultee_area WHERE consulteeCategory IN (${categoriesOf(group)})
		`;
		total += deleted;
		if (deleted < GROUP_ROWS_PER_STATEMENT) {
			return total;
		}
	}
}

/** Each group's latest load, by slug - a group never loaded has none. */
export async function latestGroupLoads(dbClient: PrismaClient): Promise<Map<string, LatestGroupLoad>> {
	const rows = await dbClient.$queryRaw<(LatestGroupLoad & { dataGroup: string })[]>`
		SELECT dataGroup, blobName, dataDate, quarter, rowsLoaded, rowsArchived, loadedAt
		FROM (
			SELECT *, ROW_NUMBER() OVER (PARTITION BY dataGroup ORDER BY loadedAt DESC, id) AS latest
			FROM reference_data_load
		) AS loads
		WHERE latest = 1
	`;
	return new Map(rows.map(({ dataGroup, ...load }) => [dataGroup, load]));
}

/** How many consultee_area rows each group has, by slug. */
export async function groupRowCounts(
	dbClient: PrismaClient,
	config: ReferenceDataConfig = REFERENCE_DATA_CONFIG
): Promise<Map<string, number>> {
	const counts = new Map<string, number>();
	for (const group of config.groups) {
		counts.set(group.slug, await groupRowCount(dbClient, group));
	}
	return counts;
}

/**
 * Load a group's file - `blobName`, downloaded to `filePath` - replacing the group's rows. The
 * file is read through first: a feature of a category from another group, or a file with no
 * features, or data from an earlier quarter than the group's loaded data, refuses the load with a
 * GroupLoadError before anything changes. Then, if the group holds an earlier quarter's data, its
 * rows move to consultee_area_archive; otherwise they're deleted. The load is logged before the
 * file's rows go in, so a load that fails partway replaces, rather than archives, its own rows
 * when it's run again.
 */
export async function importConsulteeAreaGroup(
	dbClient: PrismaClient,
	filePath: string,
	blobName: string,
	options: Omit<ImportOptions, 'replace'> & { config?: ReferenceDataConfig } = {}
): Promise<GroupLoad> {
	const config = options.config ?? REFERENCE_DATA_CONFIG;
	const file = parseGroupBlobName(blobName, config);
	if (!file) {
		throw new GroupLoadError(
			`${blobName} isn't a group's file - its name must be the date its data is from and the group, as in 20261020_public_bodies.geojson`
		);
	}
	const { group, dataDate } = file;
	const quarter = quarterOf(dataDate);
	let rowsArchived = 0;
	let archivedQuarter: string | undefined;

	const rowsLoaded = await importFile(
		dbClient,
		filePath,
		'consultee-areas',
		(feature) => {
			const row = toConsulteeArea(feature, config);
			const category = row.properties.consulteeCategory;
			if (!group.categories.has(category ?? '')) {
				const home = groupForCategory(category, config);
				throw new GroupLoadError(
					`${blobName} holds ${row.properties.sourceId ?? row.id}, a ${category ?? 'feature with no category'}, which ${
						home ? `belongs in ${home.name}` : "config/reference-data.yaml doesn't put in a group"
					} - not ${group.name}. Nothing was changed`
				);
			}
			return row;
		},
		loadConsulteeAreas,
		{
			chunkCharacters: GROUP_CHUNK_CHARACTERS,
			...options,
			beforeLoad: async (featureCount) => {
				if (featureCount === 0) {
					throw new GroupLoadError(`${blobName} holds no consultee areas. Nothing was changed`);
				}
				const loaded = (await latestGroupLoads(dbClient)).get(group.slug);
				const rows = await groupRowCount(dbClient, group);
				if (rows > 0 && loaded && loaded.quarter > quarter) {
					throw new GroupLoadError(
						`${group.name} holds ${loaded.quarter} data, and ${blobName} is from ${quarter} - an earlier quarter. Nothing was changed`
					);
				}
				if (rows > 0 && loaded && loaded.quarter < quarter) {
					rowsArchived = await archiveGroupRows(dbClient, group, loaded.quarter);
					archivedQuarter = loaded.quarter;
				} else {
					await deleteGroupRows(dbClient, group);
				}
				await dbClient.$executeRaw`
					INSERT INTO reference_data_load (dataGroup, blobName, dataDate, quarter, rowsLoaded, rowsArchived)
					VALUES (${group.slug}, ${blobName}, ${dataDate}, ${quarter}, 0, ${rowsArchived})
				`;
			}
		}
	);

	await dbClient.$executeRaw`
		UPDATE reference_data_load SET rowsLoaded = ${rowsLoaded}
		WHERE id = (
			SELECT TOP 1 id FROM reference_data_load WHERE dataGroup = ${group.slug} ORDER BY loadedAt DESC, id
		)
	`;
	return { group, quarter, rowsLoaded, rowsArchived, ...(archivedQuarter ? { archivedQuarter } : {}) };
}

/** Empty consultee_area - every group's rows - leaving the load log and the archive as they are. */
export async function clearConsulteeAreas(dbClient: PrismaClient): Promise<number> {
	return clearExistingRows(dbClient, 'consultee-areas');
}
