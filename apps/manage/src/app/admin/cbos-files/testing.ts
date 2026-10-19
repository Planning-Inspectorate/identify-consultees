import type { CbosGisFile } from './cbos-files.ts';

/** A CBOS GIS file as the function lists it - a made-up case's shapefile ZIP, unless overridden. */
export function gisFile(overrides: Partial<CbosGisFile> = {}): CbosGisFile {
	return {
		documentGuid: '0f8fad5b-d9cb-469f-a165-70867728950e',
		version: 1,
		latestVersion: 1,
		caseReference: 'EN010001',
		caseTitle: 'Example Solar Farm',
		folder: 'GIS Shapefiles',
		fileName: 'site',
		originalFileName: 'site.zip',
		mime: 'application/zip',
		size: 2048,
		publishedStatus: 'not_checked',
		createdAt: '2026-05-01T09:30:00+00:00',
		blobContainer: 'document-service-uploads',
		blobPath: '/application/EN010001/doc/v1',
		...overrides
	};
}
