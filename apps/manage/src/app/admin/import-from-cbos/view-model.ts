import type { CbosConnectionCheck, CbosImportFailure } from '../../cbos/cbos-boundaries.ts';

export interface ImportFromCbosViewModel {
	pageHeading: string;
	/** What's in the database now: cases and their boundaries, in all and from CBOS. */
	loaded?: { cases: number; boundaries: number; casesFromCbos: number; boundariesFromCbos: number };
	filesFound?: number;
	/** How many cases the imported boundaries are for. */
	casesImported?: number;
	imported?: number;
	failures?: CbosImportFailure[];
	error?: string;
	/** Why the import failed, as it said. */
	cause?: string;
	/** After a failed import: whether the function can reach CBOS at all, and if not, why. */
	connection?: CbosConnectionCheck;
}
