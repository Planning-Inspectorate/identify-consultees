import type { PrismaClient } from '../client/client.ts';
import { Prisma } from '../client/client.ts';
import {
	CONSULTEE_AREA,
	consulteeAreaTable,
	datasetInUse,
	loadConsulteeAreas,
	tableSql
} from '../geospatial/consultee-areas.ts';
import type { ImportOptions } from './geojson-import.ts';
import { CLEAR_BATCH_SIZE, clearExistingRows, importFile, toConsulteeArea } from './geojson-import.ts';
import type { ReferenceDataConfig, ReferenceDataGroup } from './reference-data.ts';
import { groupBySlug, groupForCategory, REFERENCE_DATA_CONFIG } from './reference-data.ts';

/**
 * The reference data, a group at a time, a quarter at a time. The pipeline writes a file per
 * group of config/reference-data.yaml - the report's five tabs - named for the date its data is
 * from: 20261020_public_bodies.geojson. Each quarter's data has its own table, named for the
 * quarter - consultee_area_2026Q4 - and the synonym consultee_area points at the dataset in use,
 * the newest quarter with every group loaded (see the 20261022090000 migration). Loading a group
 * replaces just its rows - its categories' - in its quarter's table.
 */

// A group's rows can be whole national-scale shapes - Public bodies' 316 areas are over 200MB of
// coastline and county boundaries - so its statements move little at a time: a few rows per
// delete, and a few megabytes of source per MERGE (a single larger shape goes alone).
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

/** The quarter a date (YYYY-MM-DD) is in, as the tables name it: 2026-10-20 → 2026Q4. */
export function quarterOf(dataDate: string): string {
	return `${dataDate.slice(0, 4)}Q${Math.ceil(Number(dataDate.slice(5, 7)) / 3)}`;
}

/** A group load refused before anything was changed - its message says why. */
export class GroupLoadError extends Error {}

/** What loading a group did. */
export interface GroupLoad {
	group: ReferenceDataGroup;
	/** The quarter it was loaded into - its table, consultee_area_2026Q4. */
	quarter: string;
	rowsLoaded: number;
	/** The dataset in use after the load: the load's quarter, once it's ready, else the one before. */
	datasetInUse: string;
	/** For a newer quarter than the one in use: the groups still to load before it's used. */
	waitingFor: ReferenceDataGroup[];
}

/** A group's latest load into a quarter, from reference_data_load. */
export interface LatestGroupLoad {
	blobName: string;
	dataDate: Date;
	quarter: string;
	rowsLoaded: number;
	loadedAt: Date;
}

function categoriesOf(group: ReferenceDataGroup): Prisma.Sql {
	return Prisma.join([...group.categories]);
}

/** How many of the group's rows `table` holds. */
async function groupRowCount(dbClient: PrismaClient, group: ReferenceDataGroup, table: string): Promise<number> {
	const [{ count }] = await dbClient.$queryRaw<{ count: number }[]>`
		SELECT COUNT(*) AS count FROM ${tableSql(table)} WHERE consulteeCategory IN (${categoriesOf(group)})
	`;
	return count;
}

/** Delete the group's rows from `table`, a batch at a time. */
async function deleteGroupRows(dbClient: PrismaClient, group: ReferenceDataGroup, table: string): Promise<number> {
	let total = 0;
	for (;;) {
		const deleted = await dbClient.$executeRaw`
			DELETE TOP (${GROUP_ROWS_PER_STATEMENT}) FROM ${tableSql(table)}
			WHERE consulteeCategory IN (${categoriesOf(group)})
		`;
		total += deleted;
		if (deleted < GROUP_ROWS_PER_STATEMENT) {
			return total;
		}
	}
}

/** Each group's latest load into `quarter`, by slug - a group not loaded into it has none. */
export async function latestGroupLoads(dbClient: PrismaClient, quarter: string): Promise<Map<string, LatestGroupLoad>> {
	const rows = await dbClient.$queryRaw<(LatestGroupLoad & { dataGroup: string })[]>`
		SELECT dataGroup, blobName, dataDate, quarter, rowsLoaded, loadedAt
		FROM (
			SELECT *, ROW_NUMBER() OVER (PARTITION BY dataGroup ORDER BY loadedAt DESC, id) AS latest
			FROM reference_data_load
			WHERE quarter = ${quarter}
		) AS loads
		WHERE latest = 1
	`;
	return new Map(rows.map(({ dataGroup, ...load }) => [dataGroup, load]));
}

/** How many rows each group has in a quarter's table - by default the dataset in use - by slug. */
export async function groupRowCounts(
	dbClient: PrismaClient,
	config: ReferenceDataConfig = REFERENCE_DATA_CONFIG,
	quarter?: string
): Promise<Map<string, number>> {
	const table = quarter ? consulteeAreaTable(quarter) : CONSULTEE_AREA;
	const counts = new Map<string, number>();
	for (const group of config.groups) {
		counts.set(group.slug, await groupRowCount(dbClient, group, table));
	}
	return counts;
}

/**
 * The groups `quarter` still needs before it's used: those with rows in the dataset in use that
 * have none in `quarter`'s table. A group with no data (Other, today) never holds it up.
 */
export async function groupsStillToLoad(
	dbClient: PrismaClient,
	quarter: string,
	config: ReferenceDataConfig = REFERENCE_DATA_CONFIG
): Promise<ReferenceDataGroup[]> {
	const inUse = await groupRowCounts(dbClient, config);
	const loaded = await groupRowCounts(dbClient, config, quarter);
	return config.groups.filter((group) => inUse.get(group.slug)! > 0 && loaded.get(group.slug) === 0);
}

/**
 * Load a group's file - `blobName`, downloaded to `filePath` - into its quarter's table,
 * consultee_area_2026Q4, made the first time one of its groups is loaded. The group's rows there
 * are replaced, so a corrected file can be loaded again; earlier quarters' tables are left as they
 * are, as the archive.
 *
 * The file is read through first: a feature of a category from another group, a file with no
 * features, or a file from an earlier quarter than the dataset in use refuses the load with a
 * GroupLoadError before anything changes. A newer quarter than the one in use becomes the dataset
 * in use once every group with data in the one in use has been loaded into it - until then the
 * tool keeps using the one before (see groupsStillToLoad). Each load is logged in
 * reference_data_load - before its rows go in, so the import page can say what's loading.
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
	const table = consulteeAreaTable(quarter);

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
		(client, featureCollection, loadOptions) =>
			loadConsulteeAreas(client, featureCollection, { ...loadOptions, table }),
		{
			chunkCharacters: GROUP_CHUNK_CHARACTERS,
			...options,
			beforeLoad: async (featureCount) => {
				if (featureCount === 0) {
					throw new GroupLoadError(`${blobName} holds no consultee areas. Nothing was changed`);
				}
				const inUse = await datasetInUse(dbClient);
				if (quarter < inUse) {
					throw new GroupLoadError(
						`${blobName} is from ${quarter}, earlier than the dataset in use, ${inUse}. Nothing was changed`
					);
				}
				await dbClient.$executeRaw`EXEC dbo.create_consultee_area_dataset ${quarter}`;
				await deleteGroupRows(dbClient, group, table);
				await dbClient.$executeRaw`
					INSERT INTO reference_data_load (dataGroup, blobName, dataDate, quarter, rowsLoaded)
					VALUES (${group.slug}, ${blobName}, ${dataDate}, ${quarter}, 0)
				`;
			}
		}
	);

	await dbClient.$executeRaw`
		UPDATE reference_data_load SET rowsLoaded = ${rowsLoaded}
		WHERE id = (
			SELECT TOP 1 id FROM reference_data_load
			WHERE dataGroup = ${group.slug} AND quarter = ${quarter}
			ORDER BY loadedAt DESC, id
		)
	`;

	let inUse = await datasetInUse(dbClient);
	let waitingFor: ReferenceDataGroup[] = [];
	if (quarter > inUse) {
		waitingFor = await groupsStillToLoad(dbClient, quarter, config);
		if (waitingFor.length === 0) {
			await dbClient.$executeRaw`EXEC dbo.use_consultee_area_dataset ${quarter}`;
			inUse = quarter;
		}
	}
	return { group, quarter, rowsLoaded, datasetInUse: inUse, waitingFor };
}

/**
 * Empty a quarter's dataset - every group's rows - or by default the one in use, a batch at a
 * time. The table stays, as do other quarters' and the load log.
 */
export async function clearConsulteeAreas(dbClient: PrismaClient, quarter?: string): Promise<number> {
	if (quarter === undefined) {
		return clearExistingRows(dbClient, 'consultee-areas');
	}
	const table = tableSql(consulteeAreaTable(quarter));
	let total = 0;
	for (;;) {
		const deleted = await dbClient.$executeRaw`DELETE TOP (${CLEAR_BATCH_SIZE}) FROM ${table}`;
		total += deleted;
		if (deleted < CLEAR_BATCH_SIZE) {
			return total;
		}
	}
}
