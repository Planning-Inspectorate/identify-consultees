export interface BoundaryFileRadio {
	/** The file option's id - the boundary's own id for real files. */
	value: string;
	/** The file's name. */
	text: string;
	/** "Uploaded: ..." when the file has a received date. */
	hint?: { text: string };
}

export interface ConsulteeProjectViewModel {
	/** "Project boundary" - the layout's h1; the case name sits above it as a caption. */
	pageHeading: string;
	pageCaption: string;
	reference: string;
	caseName: string;
	caseId: string;
	backLinkUrl: string;
	/** "Back to projects" - the layout renders the back link itself from these two. */
	backLinkText: string;
	/** Where the "Confirm shapefile" form posts. */
	formAction: string;
	/**
	 * Every shapefile the case holds, as radios - only one is carried into the report. The
	 * Design System's radios guidance says never to pre-select an option, so the items carry
	 * no `checked` state: the user must pick one before continuing.
	 */
	files: BoundaryFileRadio[];
	/** govukRadios' errorMessage param - present only after an unanswered submit. */
	shapefileError?: { text: string };
	/** The layout renders the summary itself - links to the radios fieldset. */
	errorSummary?: { text: string; href: string }[];
	/** Set when the map's files couldn't be loaded - a banner replaces the map and offers a retry. */
	mapFailed?: boolean;
	/** The banner's "Try again" link - this same page, which loads the files' geometries again. */
	retryUrl: string;
	mapId?: string;
	mapRegionLabel?: string;
	staticMapSrc?: string;
	staticMapAlt?: string;
	mapWidth?: number;
	mapHeight?: number;
	mapConfigJson?: string;
}
