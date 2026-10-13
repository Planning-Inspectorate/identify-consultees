import type { CaseBoundaryFile } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';

/**
 * The shapefile options the project boundary page offers: every stored boundary file for the case
 * (a caseReference can have several submissions - see listCaseBoundaryFiles).
 */
export interface BoundaryFileOption {
	/** The file's case_boundary id - the radio's value, the map dataset's key, and the journey's next id. */
	id: string;
	label: string;
	receivedDate: Date | null;
	/**
	 * True for the file this boundary page was opened on - the map draws it first. This is map
	 * layer state, not a form answer: the page's radios are never pre-selected (see the Design
	 * System radios guidance).
	 */
	current: boolean;
}

/**
 * The boundary page's file options: the case's stored files (its own boundary row is always one),
 * with the file the page was opened on current - or the top file when the current id isn't in the
 * list, so the map still has a boundary to draw.
 */
export function boundaryFileOptions(files: CaseBoundaryFile[], currentId: string): BoundaryFileOption[] {
	const options = files.map((file) => ({
		id: file.id,
		label: file.fileName ?? 'Unnamed file',
		receivedDate: file.receivedDate,
		current: file.id === currentId
	}));
	if (options.length > 0 && !options.some((option) => option.current)) {
		options[0].current = true;
	}
	return options;
}
