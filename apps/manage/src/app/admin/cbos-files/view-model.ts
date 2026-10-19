import type { CbosGisSummary } from './cbos-files.ts';

export interface CbosFileRow {
	href: string;
	caseReference: string;
	caseTitle: string;
	fileName: string;
	/** The folder, when it isn't GIS Shapefiles - GeoJSON filed elsewhere. */
	otherFolder?: string;
	version: string;
	type: string;
	status: string;
	created: string;
	blobPath: string;
	readByImport: boolean;
}

export type CbosFilesShow = 'all' | 'read' | 'not-read';

export interface CbosFilesViewModel {
	pageHeading: string;
	error?: string;
	summary?: CbosGisSummary;
	search: string;
	show: CbosFilesShow;
	showing?: string;
	rows?: CbosFileRow[];
}

export interface CbosFileViewModel {
	pageHeading: string;
	backLinkUrl: string;
	error?: string;
	details?: { key: string; value: string }[];
	readByImport?: boolean;
	versions?: {
		href: string;
		version: string;
		type: string;
		status: string;
		created: string;
		current: boolean;
		readByImport: boolean;
	}[];
	problem?: string;
	content?: {
		bytes: string;
		kind: string;
		problem?: string;
		entries?: { name: string; size: string }[];
		missingParts?: string[];
		geojson?: { key: string; value: string }[];
		firstFeatureProperties?: string;
		preview?: string;
	};
}
