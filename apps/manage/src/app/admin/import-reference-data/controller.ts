import type { ManageService } from '#service';
import { datasetInUse, listDatasets } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import type { GroupLoad, LatestGroupLoad } from '@pins/identify-consultees-database/src/seed/consultee-area-groups.ts';
import {
	clearConsulteeAreas,
	GroupLoadError,
	groupRowCounts,
	groupsStillToLoad,
	importConsulteeAreaGroup,
	latestGroupLoads,
	parseGroupBlobName,
	quarterOf
} from '@pins/identify-consultees-database/src/seed/consultee-area-groups.ts';
import { importCaseBoundaries } from '@pins/identify-consultees-database/src/seed/geojson-import.ts';
import type { StoredBlob } from '@pins/identify-consultees-database/src/seed/import-from-blob.ts';
import { downloadBlobToTempFile, listBlobs } from '@pins/identify-consultees-database/src/seed/import-from-blob.ts';
import type { ReferenceDataGroup } from '@pins/identify-consultees-database/src/seed/reference-data.ts';
import {
	groupBySlug,
	REFERENCE_DATA_CONFIG,
	UnknownDatasetError
} from '@pins/identify-consultees-database/src/seed/reference-data.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import type { Request } from 'express';
import type { GroupStatus, ImportReferenceDataViewModel } from './view-model.ts';

const VIEW = 'admin/import-reference-data/view.njk';
const PAGE_HEADING = 'Import reference data into the database';

// the case boundaries' blob - the DB Seed pipeline's loadFullReferenceData option looks for it too
// (.azure/pipelines/db-seed.yml), as it does combined_reference_data_v1.geojson for a full import
export const CASE_BOUNDARIES_BLOB_NAME = 'all-project-boundaries.geojson';

/** Where the page finds, and fetches, the files it loads - blob storage, but for tests. */
export interface BlobFiles {
	list: () => Promise<StoredBlob[]>;
	download: typeof downloadBlobToTempFile;
}

const BLOB_STORAGE: BlobFiles = { list: listBlobs, download: downloadBlobToTempFile };

/** Each group's newest file in blob storage - by the date its data is from - by slug. */
function latestGroupFiles(blobs: StoredBlob[]): Map<string, StoredBlob & { dataDate: string }> {
	const latest = new Map<string, StoredBlob & { dataDate: string }>();
	for (const blob of blobs) {
		const file = parseGroupBlobName(blob.name);
		const current = file ? latest.get(file.group.slug) : undefined;
		if (file && (!current || file.dataDate > current.dataDate)) {
			latest.set(file.group.slug, { ...blob, dataDate: file.dataDate });
		}
	}
	return latest;
}

const formatDate = (date: Date) =>
	date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const formatDateTime = (date: Date) =>
	date.toLocaleString('en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'Europe/London'
	});

/** A file's size as the page gives it: 1.4MB, 512KB. */
export function formatSize(bytes: number): string {
	return bytes < 1024 * 1024
		? `${Math.max(1, Math.round(bytes / 1024))}KB`
		: `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`;
}

function groupStatus(
	group: ReferenceDataGroup,
	file: (StoredBlob & { dataDate: string }) | undefined,
	rows: number | undefined,
	load: LatestGroupLoad | undefined,
	pendingRows: number | undefined
): GroupStatus {
	return {
		name: group.name,
		slug: group.slug,
		categories: [...group.categories].join(', '),
		...(file
			? {
					file: {
						name: file.name,
						dataDate: formatDate(new Date(`${file.dataDate}T00:00:00Z`)),
						quarter: quarterOf(file.dataDate),
						size: formatSize(file.size)
					}
				}
			: {}),
		...(rows === undefined ? {} : { rows }),
		...(load
			? {
					load: {
						blobName: load.blobName,
						quarter: load.quarter,
						loadedAt: formatDateTime(load.loadedAt),
						rowsLoaded: load.rowsLoaded
					}
				}
			: {}),
		...(pendingRows === undefined ? {} : { pendingRows })
	};
}

/**
 * The page as it stands: rows in each table, the quarters' datasets - which is in use, and what a
 * newer one is still waiting for - and each group: its newest file in blob storage, its rows now
 * and its last load. A full load can outlast Front Door's response timeout - the browser shows an
 * error while it carries on - so the counts are how to confirm it finished. Informational only:
 * what can't be read is left off the page, and logged.
 */
async function withStatus(
	service: Pick<ManageService, 'db' | 'logger'>,
	files: BlobFiles,
	viewModel: ImportReferenceDataViewModel
): Promise<ImportReferenceDataViewModel> {
	const { db, logger } = service;
	const attempt = async <T>(what: string, read: () => Promise<T>): Promise<T | undefined> => {
		try {
			return await read();
		} catch (error) {
			logger.warn({ error }, `Could not read ${what}`);
			return undefined;
		}
	};
	const [counts, rows, inUse, datasets, blobs] = await Promise.all([
		attempt('the loaded reference data', async () => {
			const [row] = await db.$queryRaw<{ consulteeAreas: number; caseBoundaries: number }[]>`
				SELECT (SELECT COUNT(*) FROM consultee_area) AS consulteeAreas,
					(SELECT COUNT(*) FROM case_boundary) AS caseBoundaries
			`;
			return row;
		}),
		attempt("each group's rows", () => groupRowCounts(db)),
		attempt('the dataset in use', () => datasetInUse(db)),
		attempt('the datasets', () => listDatasets(db)),
		attempt('the files in blob storage', files.list)
	]);
	// a newer quarter than the one in use is being loaded, a group at a time
	const pending = inUse ? datasets?.find((dataset) => dataset.quarter > inUse) : undefined;
	const [loads, pendingRows, waitingFor] = await Promise.all([
		inUse ? attempt("each group's last load", () => latestGroupLoads(db, inUse)) : undefined,
		pending
			? attempt(`each group's rows in ${pending.quarter}`, () => groupRowCounts(db, undefined, pending.quarter))
			: undefined,
		pending
			? attempt(`what ${pending.quarter} is waiting for`, () => groupsStillToLoad(db, pending.quarter))
			: undefined
	]);
	const groupFiles = latestGroupFiles(blobs ?? []);
	return {
		...viewModel,
		...(counts ? { loadedConsulteeAreas: counts.consulteeAreas, loadedCaseBoundaries: counts.caseBoundaries } : {}),
		...(inUse ? { datasetInUse: inUse } : {}),
		...(datasets
			? {
					datasets: datasets.map((dataset) => ({
						quarter: dataset.quarter,
						rows: dataset.rows,
						status: dataset.quarter === inUse ? 'In use' : inUse && dataset.quarter > inUse ? 'Loading' : 'Archive'
					}))
				}
			: {}),
		...(pending && waitingFor
			? { pending: { quarter: pending.quarter, waitingFor: waitingFor.map((group) => group.name) } }
			: {}),
		blobStorageRead: blobs !== undefined,
		groups: REFERENCE_DATA_CONFIG.groups.map((group) =>
			groupStatus(
				group,
				groupFiles.get(group.slug),
				rows?.get(group.slug),
				loads?.get(group.slug),
				pendingRows?.get(group.slug)
			)
		)
	};
}

export function buildImportReferenceDataPage(
	service: ManageService,
	files: BlobFiles = BLOB_STORAGE
): AsyncRequestHandler {
	return async (req, res) => {
		return res.render(VIEW, await withStatus(service, files, { pageHeading: PAGE_HEADING }));
	};
}

function groupOf(req: Request): ReferenceDataGroup | undefined {
	return groupBySlug((req.body as { group?: unknown } | undefined)?.group);
}

/** What a group load means for the dataset in use. */
export function loadOutcome(load: Pick<GroupLoad, 'quarter' | 'datasetInUse' | 'waitingFor'>): string {
	if (load.datasetInUse === load.quarter) {
		return `${load.quarter} is the dataset in use.`;
	}
	const names = load.waitingFor.map((group) => group.name);
	const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
	return `The tool keeps using ${load.datasetInUse} until ${list} ${names.length > 1 ? 'are' : 'is'} loaded for ${load.quarter}.`;
}

/**
 * Load a group: its newest file in blob storage replaces its rows in its quarter's table, which
 * becomes the dataset in use once every group has been loaded into it (see importConsulteeAreaGroup).
 */
export function buildRunImportConsulteeAreaGroup(
	service: ManageService,
	files: BlobFiles = BLOB_STORAGE,
	runImport: typeof importConsulteeAreaGroup = importConsulteeAreaGroup
): AsyncRequestHandler {
	const { logger } = service;
	// loads run on the bulk client - their statements can take minutes (see ManageService.bulkDb)
	const db = service.bulkDb ?? service.db;

	return async (req, res) => {
		const viewModel: ImportReferenceDataViewModel = { pageHeading: PAGE_HEADING };
		const group = groupOf(req);
		if (!group) {
			viewModel.error = 'Could not load the group. Choose a group to load.';
			return res.render(VIEW, await withStatus(service, files, viewModel));
		}
		try {
			const file = latestGroupFiles(await files.list()).get(group.slug);
			if (!file) {
				throw new GroupLoadError(`There's no ${group.name} file in blob storage - upload one first`);
			}
			const { filePath, cleanup } = await files.download(file.name);
			try {
				const load = await runImport(db, filePath, file.name);
				viewModel.groupLoaded = `Loaded ${group.name} from ${file.name} into ${load.quarter}: ${load.rowsLoaded} consultee areas. ${loadOutcome(load)}`;
				logger.info(
					{
						group: group.slug,
						blob: file.name,
						quarter: load.quarter,
						rowsLoaded: load.rowsLoaded,
						inUse: load.datasetInUse
					},
					'loaded a reference data group'
				);
			} finally {
				await cleanup();
			}
		} catch (error) {
			logger.error({ error, group: group.slug }, 'Failed to load a reference data group');
			viewModel.error =
				error instanceof GroupLoadError || error instanceof UnknownDatasetError
					? `Could not load ${group.name}. ${error.message}.`
					: `Could not load ${group.name} from blob storage.`;
		}
		return res.render(VIEW, await withStatus(service, files, viewModel));
	};
}

/**
 * Empty the chosen quarter's dataset - every group - leaving its table, other quarters', what's in
 * blob storage and the load log.
 */
export function buildClearConsulteeAreas(
	service: ManageService,
	files: BlobFiles = BLOB_STORAGE,
	clear: typeof clearConsulteeAreas = clearConsulteeAreas
): AsyncRequestHandler {
	const { logger } = service;
	// loads run on the bulk client - their statements can take minutes (see ManageService.bulkDb)
	const db = service.bulkDb ?? service.db;

	return async (req, res) => {
		const viewModel: ImportReferenceDataViewModel = { pageHeading: PAGE_HEADING };
		const quarter = (req.body as { quarter?: unknown } | undefined)?.quarter;
		try {
			// only a quarter that has a dataset - the choice the page offers
			const datasets = await listDatasets(db);
			if (typeof quarter !== 'string' || !datasets.some((dataset) => dataset.quarter === quarter)) {
				viewModel.error = 'Choose a dataset to clear.';
				return res.render(VIEW, await withStatus(service, files, viewModel));
			}
			const deleted = await clear(db, quarter);
			viewModel.consulteeAreasCleared = { quarter, deleted };
			logger.info({ quarter, rows: deleted }, 'cleared a consultee area dataset');
		} catch (error) {
			logger.error({ error, quarter }, 'Failed to clear a consultee area dataset');
			viewModel.error = 'Could not clear the consultee areas.';
		}
		return res.render(VIEW, await withStatus(service, files, viewModel));
	};
}

export function buildRunImportCaseBoundaries(
	service: ManageService,
	files: BlobFiles = BLOB_STORAGE,
	runImport: typeof importCaseBoundaries = importCaseBoundaries
): AsyncRequestHandler {
	const { logger } = service;
	// loads run on the bulk client - their statements can take minutes (see ManageService.bulkDb)
	const db = service.bulkDb ?? service.db;

	return async (req, res) => {
		const viewModel: ImportReferenceDataViewModel = { pageHeading: PAGE_HEADING };

		try {
			const { filePath, cleanup } = await files.download(CASE_BOUNDARIES_BLOB_NAME);
			try {
				// merged by id, not replacing the table: that would delete every boundary CBOS imported
				viewModel.caseBoundariesImported = await runImport(db, filePath);
			} finally {
				await cleanup();
			}
		} catch (error) {
			logger.error({ error }, 'Failed to import case boundaries from blob storage');
			viewModel.error = 'Could not import case boundaries from blob storage.';
		}

		return res.render(VIEW, await withStatus(service, files, viewModel));
	};
}
