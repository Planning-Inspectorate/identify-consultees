export interface ConsulteeRow {
	/** The consultee's name (e.g. the council or authority), fallback "Unnamed consultee". */
	name: string;
	/**
	 * Every reason the consultee was identified, one per line - the ruleset conditions it met and/or
	 * the general nearby search (see reasons.ts), or for one added by hand, the reason given
	 * ("Manually added" when none was).
	 */
	identified: string[];
	/**
	 * How far it is from the site, as the table shows it ("3.4 km") and in metres for sorting
	 * (sortable-table.js) - absent for one added by hand that the run didn't find, which has none.
	 */
	distance?: { text: string; metres: number };
	/** The "Remove consultee" page for this row - it records the removal reason, then returns here. */
	removeUrl: string;
	/**
	 * The bulk-remove checkbox for this row: the query param it submits and the input's DOM id.
	 * `consulteeId` names the row's map feature (its `consulteeId`), so the row-select plugin can
	 * grey it when the feature is selected and select it when the row is clicked - absent for a
	 * consultee added by name alone, which is on no map.
	 */
	select: { param: string; value: string; domId: string; consulteeId?: string };
}

/** One row of the expandable Removed consultees section - a removal and the reason given. */
export interface RemovedConsulteeRow {
	name: string;
	reason: string;
}

export interface ReportConsulteesViewModel {
	/** The category as the page names it - Nearby NSIPs spelled out; the case name sits above it as a caption. */
	pageHeading: string;
	pageCaption: string;
	/** Back to the draft report, with the changes made since the page was opened kept. */
	backLinkUrl: string;
	/** "Back to draft report" - the layout renders the back link itself from these two. */
	backLinkText: string;
	rows: ConsulteeRow[];
	/**
	 * The bulk-remove form around the table: a bare GET action (the form's fields carry the state -
	 * see bulkRemoveConsulteeUrl) and the hidden inputs re-sending the ruleset, category and
	 * selection alongside the checked rows.
	 */
	bulkRemove: { formAction: string; hiddenParams: { name: string; value: string }[] };
	/** The "Add a consultee" page the Add consultee link opens, keeping the current selection. */
	addConsulteeUrl: string;
	mapId: string;
	mapRegionLabel: string;
	staticMapSrc: string;
	staticMapAlt: string;
	mapWidth: number;
	mapHeight: number;
	mapConfigJson: string;
	/** This category's recorded removals - the Removed consultees section renders when non-empty. */
	removedRows: RemovedConsulteeRow[];
	/** Opens the Removed consultees section - set by the remove page's redirect back here. */
	removedOpen: boolean;
	/**
	 * The bulk-remove form's missed selection - set when "Remove selected consultees" comes back here on
	 * `error=select` for the page to flag rather than leaving it to a 404.
	 */
	errorSummary?: { text: string; href: string }[];
	/** True when the site was screened against its bounding box - the list needs reviewing. */
	screenedBoundingBox: boolean;
	retryUrl: string;
	/** Total matches the ruleset found in this category - may exceed what the map draws. */
}
