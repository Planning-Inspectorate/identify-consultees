/**
 * View model for /map-external-controls-demo: the fictional "Arrow Valley Solar" boundary
 * page rendered with a selectable externalControls plugin configuration (?mode=), so the
 * emphasis/primaryControl options can be compared. One map per page is deliberate: the
 * Defra datasets plugin keeps its dataset registry and layer adapter as module-level
 * singletons, so two interactive maps on one page would share mutable state.
 */

export interface ExternalControlsDemoRadio {
	value: string;
	text: string;
	hint?: { text: string };
	checked?: boolean;
}

export interface ExternalControlsDemoMode {
	/** The ?mode= value this link selects. */
	slug: string;
	label: string;
	href: string;
	/** The mode this render is showing - marked aria-current in the switcher. */
	current: boolean;
}

export interface ExternalControlsDemoSection {
	/** Unique slug - prefixes the map id and radio ids, and scopes the plugin's control selector. */
	slug: string;
	title: string;
	/** What this section's configuration demonstrates. */
	description: string;
	mapId: string;
	mapRegionLabel: string;
	staticMapSrc: string;
	staticMapAlt: string;
	mapConfigJson: string;
	/** Pretty-printed `externalControls` block, shown in the "How this map is configured" panel. */
	configSnippet: string;
	/** The wrapping form's id - the plugin's `control` selector scopes to it. */
	formId: string;
	radiosIdPrefix: string;
	radioItems: ExternalControlsDemoRadio[];
	/** govukRadios errorMessage on the radios after the form was submitted with no pick. */
	radiosError?: { text: string };
	/** The file the form submitted - its radio stays checked on re-render. */
	submittedValue?: string;
}

export interface MapExternalControlsDemoViewModel {
	pageHeading: string;
	pageCaption: string;
	mapWidth: number;
	mapHeight: number;
	section: ExternalControlsDemoSection;
	/** Switcher links for the three plugin configurations. */
	modes: ExternalControlsDemoMode[];
	/** Success-banner text after the form posted a valid pick. */
	submittedBanner?: string;
	/** Validation summary entries after an unanswered submit (one per error). */
	errorSummary?: { text: string; href: string }[];
}
