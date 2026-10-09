import type { ManageService } from '#service';
import { auditActor } from '#util/auth.ts';
import {
	importCaseBoundaries,
	importConsulteeAreas
} from '@pins/identify-consultees-database/src/seed/geojson-import.ts';
import { downloadBlobToTempFile } from '@pins/identify-consultees-database/src/seed/import-from-blob.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import type { ImportReferenceDataViewModel } from './view-model.ts';

const VIEW = 'views/admin-import-reference-data/view.njk';
const PAGE_HEADING = 'Import reference data into the database';

// the two blob names the DB Seed pipeline's loadFullReferenceData option also looks for
// (.azure/pipelines/db-seed.yml) - same files, uploaded once via /admin/upload-to-blob, imported
// from here instead of there because this app's own managed identity already has Storage Blob
// Data Contributor on the container (infrastructure/storage.tf), unlike the seed pipeline's.
export const CONSULTEE_AREAS_BLOB_NAME = 'combined_reference_data_v1.geojson';
export const CASE_BOUNDARIES_BLOB_NAME = 'all-project-boundaries.geojson';

// imports replace each table rather than merging into it - see clearExistingRows. The loaders
// upsert by id and never delete, so a merge would leave the sample data, or rows the new file
// dropped or re-keyed, behind as stale or duplicate consultees
const REPLACE = { replace: true } as const;

/**
 * Rows in each table right now. A full import into Azure SQL can outlast Front Door's response
 * timeout - the browser then shows an error while the import carries on - so the page shows these
 * to confirm when it's finished. Informational only: a failure just leaves them off the page.
 */
async function withLoadedCounts(
	service: Pick<ManageService, 'db' | 'logger'>,
	viewModel: ImportReferenceDataViewModel
): Promise<ImportReferenceDataViewModel> {
	try {
		const [counts] = await service.db.$queryRaw<{ consulteeAreas: number; caseBoundaries: number }[]>`
			SELECT (SELECT COUNT(*) FROM consultee_area) AS consulteeAreas,
				(SELECT COUNT(*) FROM case_boundary) AS caseBoundaries
		`;
		return { ...viewModel, loadedConsulteeAreas: counts.consulteeAreas, loadedCaseBoundaries: counts.caseBoundaries };
	} catch (error) {
		service.logger.warn({ error }, 'Could not count the loaded reference data');
		return viewModel;
	}
}

export function buildImportReferenceDataPage(service: ManageService): AsyncRequestHandler {
	return async (req, res) => {
		return res.render(VIEW, await withLoadedCounts(service, { pageHeading: PAGE_HEADING }));
	};
}

export function buildRunImportConsulteeAreas(
	service: ManageService,
	download: typeof downloadBlobToTempFile = downloadBlobToTempFile,
	runImport: typeof importConsulteeAreas = importConsulteeAreas
): AsyncRequestHandler {
	const { db, logger } = service;

	return async (req, res) => {
		const viewModel: ImportReferenceDataViewModel = { pageHeading: PAGE_HEADING };
		const actor = auditActor(req);

		try {
			const { filePath, cleanup } = await download(CONSULTEE_AREAS_BLOB_NAME);
			try {
				viewModel.consulteeAreasImported = await runImport(db, filePath, REPLACE);
				logger.info(
					{ ...actor, blobName: CONSULTEE_AREAS_BLOB_NAME, imported: viewModel.consulteeAreasImported },
					'admin: replaced consultee areas from blob storage'
				);
			} finally {
				await cleanup();
			}
		} catch (error) {
			logger.error({ ...actor, error }, 'Failed to import consultee areas from blob storage');
			viewModel.error = 'Could not import consultee areas from blob storage.';
		}

		return res.render(VIEW, await withLoadedCounts(service, viewModel));
	};
}

export function buildRunImportCaseBoundaries(
	service: ManageService,
	download: typeof downloadBlobToTempFile = downloadBlobToTempFile,
	runImport: typeof importCaseBoundaries = importCaseBoundaries
): AsyncRequestHandler {
	const { db, logger } = service;

	return async (req, res) => {
		const viewModel: ImportReferenceDataViewModel = { pageHeading: PAGE_HEADING };
		const actor = auditActor(req);

		try {
			const { filePath, cleanup } = await download(CASE_BOUNDARIES_BLOB_NAME);
			try {
				viewModel.caseBoundariesImported = await runImport(db, filePath, REPLACE);
				logger.info(
					{ ...actor, blobName: CASE_BOUNDARIES_BLOB_NAME, imported: viewModel.caseBoundariesImported },
					'admin: replaced case boundaries from blob storage'
				);
			} finally {
				await cleanup();
			}
		} catch (error) {
			logger.error({ ...actor, error }, 'Failed to import case boundaries from blob storage');
			viewModel.error = 'Could not import case boundaries from blob storage.';
		}

		return res.render(VIEW, await withLoadedCounts(service, viewModel));
	};
}
