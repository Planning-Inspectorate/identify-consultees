export interface BoundaryFileRadio {
	/** The file option's id - the boundary's own id for real files. */
	value: string;
	/** The file's name. */
	text: string;
	/** "Uploaded: ..." when the file has a received date. */
	hint?: { text: string };
	/** True for the file this boundary page was opened on. */
	checked: boolean;
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
	/** Every shapefile the case holds, as radios - only one is carried into the report. */
	files: BoundaryFileRadio[];
	mapId: string;
	mapRegionLabel: string;
	staticMapSrc: string;
	staticMapAlt: string;
	mapWidth: number;
	mapHeight: number;
	mapConfigJson: string;
}
