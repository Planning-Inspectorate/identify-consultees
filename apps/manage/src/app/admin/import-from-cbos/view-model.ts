import type { CbosImportFailure } from './cbos-boundaries.ts';

export interface ImportFromCbosViewModel {
	pageHeading: string;
	loadedCaseBoundaries?: number;
	loadedFromCbos?: number;
	filesFound?: number;
	imported?: number;
	failures?: CbosImportFailure[];
	error?: string;
}
