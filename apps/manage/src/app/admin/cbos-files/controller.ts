import type { ManageService } from '#service';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import type { Request } from 'express';
import { formatDateTime } from '../database/controller.ts';
import {
	CbosFunctionError,
	fileKey,
	filesTheImportReads,
	GEOJSON_MIME,
	GIS_SHAPEFILES_FOLDER,
	isLongitudeLatitude,
	isZip,
	listCbosGisFiles,
	missingShapefileParts,
	readCbosGisFile,
	summarise,
	type CbosGisFile,
	type CbosGisFileDetail
} from './cbos-files.ts';
import type { CbosFileRow, CbosFilesShow, CbosFilesViewModel, CbosFileViewModel } from './view-model.ts';

const LIST_URL = '/admin/cbos-files';
// enough to scan; past it, filter by case
export const MAX_ROWS = 500;

export interface CbosFilesDependencies {
	listFiles: typeof listCbosGisFiles;
	readFile: typeof readCbosGisFile;
}

const DEFAULT_DEPENDENCIES: CbosFilesDependencies = { listFiles: listCbosGisFiles, readFile: readCbosGisFile };

function options(service: ManageService) {
	return { pythonFunctionUrl: service.pythonFunctionUrl, apiKey: service.pythonFunctionApiKey };
}

function queryText(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function typeLabel(file: CbosGisFile): string {
	if (isZip(file)) {
		return 'ZIP';
	}
	return file.mime === GEOJSON_MIME ? 'GeoJSON' : (file.mime ?? '');
}

function date(value: string | null): string {
	return value ? formatDateTime(new Date(value)) : '';
}

function fileHref(file: Pick<CbosGisFile, 'documentGuid' | 'version'>): string {
	return `${LIST_URL}/${encodeURIComponent(file.documentGuid)}/${file.version}`;
}

function toRow(file: CbosGisFile, readByImport: boolean): CbosFileRow {
	return {
		href: fileHref(file),
		caseReference: file.caseReference ?? '',
		caseTitle: file.caseTitle ?? '',
		fileName: file.originalFileName ?? file.fileName ?? file.documentGuid,
		otherFolder: file.folder === GIS_SHAPEFILES_FOLDER ? undefined : file.folder,
		version: file.latestVersion ? `${file.version} of ${file.latestVersion}` : String(file.version),
		type: typeLabel(file),
		status: file.publishedStatus ?? '',
		created: date(file.createdAt),
		blobPath: file.blobPath ?? '',
		readByImport
	};
}

function describeError(error: unknown): string {
	return error instanceof CbosFunctionError ? error.message : 'the Python function could not be reached';
}

/** Every file in CBOS's GIS Shapefiles folders, filtered by case and by whether the import reads it. */
export function buildCbosFilesPage(
	service: ManageService,
	dependencies: CbosFilesDependencies = DEFAULT_DEPENDENCIES
): AsyncRequestHandler {
	return async (req, res) => {
		const search = queryText(req.query.case);
		const showParam = queryText(req.query.show);
		const show: CbosFilesShow = showParam === 'read' || showParam === 'not-read' ? showParam : 'all';
		const viewModel: CbosFilesViewModel = { pageHeading: 'CBOS files', search, show };

		let listing;
		try {
			listing = await dependencies.listFiles(options(service));
		} catch (error) {
			service.logger.error({ error }, 'Failed to list the CBOS GIS files');
			return res.render('admin/cbos-files/view.njk', {
				...viewModel,
				error: `Could not list CBOS's files: ${describeError(error)}.`
			});
		}

		const read = filesTheImportReads(listing.files);
		const needle = search.toLowerCase();
		const matching = listing.files
			.map((file) => toRow(file, read.has(fileKey(file))))
			.filter((row) => !needle || `${row.caseReference} ${row.caseTitle}`.toLowerCase().includes(needle))
			.filter((row) => show === 'all' || row.readByImport === (show === 'read'));
		const rows = matching.slice(0, MAX_ROWS);

		return res.render('admin/cbos-files/view.njk', {
			...viewModel,
			summary: summarise(listing, read),
			rows,
			showing:
				matching.length > rows.length
					? `Showing the first ${rows.length} of ${matching.length} files - filter by case to see the rest.`
					: `Showing ${matching.length} of ${listing.files.length} files.`
		});
	};
}

function formatBytes(bytes: number | null | undefined): string {
	if (bytes === null || bytes === undefined) {
		return '';
	}
	return bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toLocaleString('en-GB', { maximumFractionDigits: 1 })} KB`;
}

function json(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function contentViewModel(detail: CbosGisFileDetail): CbosFileViewModel['content'] {
	const content = detail.content;
	if (!content) {
		return undefined;
	}
	const lonLat = isLongitudeLatitude(content.firstPosition);
	return {
		bytes: formatBytes(content.bytes),
		kind: content.kind,
		problem: content.problem,
		entries: content.entries?.map((entry) => ({ name: entry.name, size: formatBytes(entry.size) })),
		missingParts: content.entries ? missingShapefileParts(content.entries) : undefined,
		geojson:
			content.kind === 'geojson'
				? [
						{ key: 'Features', value: String(content.featureCount) },
						{ key: 'Geometry types', value: (content.geometryTypes ?? []).join(', ') },
						{ key: 'CRS', value: content.crs ? json(content.crs) : 'None given (GeoJSON means WGS84)' },
						{
							key: 'First position',
							value: content.firstPosition
								? `${content.firstPosition.join(', ')} - ${
										lonLat ? 'longitude and latitude' : 'not longitude and latitude (British National Grid metres?)'
									}`
								: 'None'
						}
					]
				: undefined,
		firstFeatureProperties:
			content.firstFeatureProperties === undefined ? undefined : json(content.firstFeatureProperties),
		preview: content.preview
	};
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestedFile(req: Request): { documentGuid: string; version: number } | undefined {
	const documentGuid = String(req.params.guid ?? '');
	const version = Number(req.params.version);
	return UUID_PATTERN.test(documentGuid) && Number.isInteger(version) && version >= 0
		? { documentGuid, version }
		: undefined;
}

function notFound(res: Parameters<AsyncRequestHandler>[1]) {
	return res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
}

/** One CBOS file's details, and what its blob holds - or why it couldn't be read. */
export function buildCbosFilePage(
	service: ManageService,
	dependencies: CbosFilesDependencies = DEFAULT_DEPENDENCIES
): AsyncRequestHandler {
	return async (req, res) => {
		const requested = requestedFile(req);
		if (!requested) {
			return notFound(res);
		}

		let detail: CbosGisFileDetail;
		try {
			detail = await dependencies.readFile(options(service), requested.documentGuid, requested.version);
		} catch (error) {
			if (error instanceof CbosFunctionError && error.status === 404) {
				return notFound(res);
			}
			service.logger.error({ error }, 'Failed to read a CBOS GIS file');
			const viewModel: CbosFileViewModel = {
				pageHeading: 'CBOS file',
				backLinkUrl: LIST_URL,
				error: `Could not read the file: ${describeError(error)}.`
			};
			return res.render('admin/cbos-files/file.njk', viewModel);
		}

		const { file } = detail;
		const readVersions = filesTheImportReads(detail.versions);
		const read = readVersions.has(fileKey(file));
		const viewModel: CbosFileViewModel = {
			pageHeading: toRow(file, read).fileName,
			backLinkUrl: file.caseReference ? `${LIST_URL}?case=${encodeURIComponent(file.caseReference)}` : LIST_URL,
			details: [
				{ key: 'Case', value: [file.caseReference, file.caseTitle].filter(Boolean).join(' - ') },
				{ key: 'Folder', value: file.folder },
				{ key: 'File name', value: file.fileName ?? '' },
				{ key: 'Original file name', value: file.originalFileName ?? '' },
				{ key: 'Document', value: file.documentGuid },
				{ key: 'Version', value: toRow(file, read).version },
				{ key: 'Type', value: file.mime ?? '' },
				{ key: 'Size', value: formatBytes(file.size) },
				{ key: 'Status', value: file.publishedStatus ?? '' },
				{ key: 'Created', value: date(file.createdAt) },
				{ key: 'Blob container', value: file.blobContainer ?? '' },
				{ key: 'Blob path', value: file.blobPath ?? '' }
			],
			readByImport: read,
			versions: detail.versions.map((version) => {
				const row = toRow(version, readVersions.has(fileKey(version)));
				return {
					href: row.href,
					version: row.version,
					type: row.type,
					status: row.status,
					created: row.created,
					current: version.version === file.version,
					readByImport: row.readByImport
				};
			}),
			problem: detail.problem,
			content: contentViewModel(detail)
		};
		return res.render('admin/cbos-files/file.njk', viewModel);
	};
}
