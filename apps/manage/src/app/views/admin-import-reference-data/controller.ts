import type { ManageService } from '#service';
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

export function buildImportReferenceDataPage(): AsyncRequestHandler {
	return async (req, res) => {
		const viewModel: ImportReferenceDataViewModel = { pageHeading: PAGE_HEADING };
		return res.render(VIEW, viewModel);
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

		try {
			const { filePath, cleanup } = await download(CONSULTEE_AREAS_BLOB_NAME);
			try {
				viewModel.consulteeAreasImported = await runImport(db, filePath);
			} finally {
				await cleanup();
			}
		} catch (error) {
			logger.error({ error }, 'Failed to import consultee areas from blob storage');
			viewModel.error = 'Could not import consultee areas from blob storage.';
		}

		return res.render(VIEW, viewModel);
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

		try {
			const { filePath, cleanup } = await download(CASE_BOUNDARIES_BLOB_NAME);
			try {
				viewModel.caseBoundariesImported = await runImport(db, filePath);
			} finally {
				await cleanup();
			}
		} catch (error) {
			logger.error({ error }, 'Failed to import case boundaries from blob storage');
			viewModel.error = 'Could not import case boundaries from blob storage.';
		}

		return res.render(VIEW, viewModel);
	};
}
