import type { ManageService } from '#service';
import type { LatestGroupLoad } from '@pins/identify-consultees-database/src/seed/consultee-area-groups.ts';
import {
	clearConsulteeAreas,
	GroupLoadError,
	groupRowCounts,
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

// case boundaries replace the table rather than merge into it - see clearExistingRows
const REPLACE = { replace: true } as const;

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
	load: LatestGroupLoad | undefined
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
						rowsLoaded: load.rowsLoaded,
						rowsArchived: load.rowsArchived
					}
				}
			: {})
	};
}

/**
 * The page as it stands: rows in each table, and each group - its newest file in blob storage,
 * its rows now and its last load. A full load can outlast Front Door's response timeout - the
 * browser shows an error while it carries on - so the counts are how to confirm it finished.
 * Informational only: what can't be read is left off the page, and logged.
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
	const [counts, rows, loads, blobs] = await Promise.all([
		attempt('the loaded reference data', async () => {
			const [row] = await db.$queryRaw<{ consulteeAreas: number; caseBoundaries: number }[]>`
				SELECT (SELECT COUNT(*) FROM consultee_area) AS consulteeAreas,
					(SELECT COUNT(*) FROM case_boundary) AS caseBoundaries
			`;
			return row;
		}),
		attempt("each group's rows", () => groupRowCounts(db)),
		attempt("each group's last load", () => latestGroupLoads(db)),
		attempt('the files in blob storage', files.list)
	]);
	const groupFiles = latestGroupFiles(blobs ?? []);
	return {
		...viewModel,
		...(counts ? { loadedConsulteeAreas: counts.consulteeAreas, loadedCaseBoundaries: counts.caseBoundaries } : {}),
		blobStorageRead: blobs !== undefined,
		groups: REFERENCE_DATA_CONFIG.groups.map((group) =>
			groupStatus(group, groupFiles.get(group.slug), rows?.get(group.slug), loads?.get(group.slug))
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

/**
 * Load a group: its newest file in blob storage replaces its rows - or, from a later quarter than
 * the group's, archives them first (see importConsulteeAreaGroup).
 */
export function buildRunImportConsulteeAreaGroup(
	service: ManageService,
	files: BlobFiles = BLOB_STORAGE,
	runImport: typeof importConsulteeAreaGroup = importConsulteeAreaGroup
): AsyncRequestHandler {
	const { db, logger } = service;

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
				viewModel.groupLoaded =
					`Loaded ${group.name} from ${file.name}: ${load.rowsLoaded} consultee areas, ${load.quarter}.` +
					(load.archivedQuarter ? ` Archived its ${load.rowsArchived} ${load.archivedQuarter} consultee areas.` : '');
				logger.info(
					{
						group: group.slug,
						blob: file.name,
						quarter: load.quarter,
						rowsLoaded: load.rowsLoaded,
						rowsArchived: load.rowsArchived
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

/** Empty consultee_area - every group - leaving what's in blob storage, the archive and the load log. */
export function buildClearConsulteeAreas(
	service: ManageService,
	files: BlobFiles = BLOB_STORAGE,
	clear: typeof clearConsulteeAreas = clearConsulteeAreas
): AsyncRequestHandler {
	const { db, logger } = service;

	return async (req, res) => {
		const viewModel: ImportReferenceDataViewModel = { pageHeading: PAGE_HEADING };
		try {
			viewModel.consulteeAreasCleared = await clear(db);
			logger.info({ rows: viewModel.consulteeAreasCleared }, 'cleared the consultee areas');
		} catch (error) {
			logger.error({ error }, 'Failed to clear the consultee areas');
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
	const { db, logger } = service;

	return async (req, res) => {
		const viewModel: ImportReferenceDataViewModel = { pageHeading: PAGE_HEADING };

		try {
			const { filePath, cleanup } = await files.download(CASE_BOUNDARIES_BLOB_NAME);
			try {
				viewModel.caseBoundariesImported = await runImport(db, filePath, REPLACE);
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
