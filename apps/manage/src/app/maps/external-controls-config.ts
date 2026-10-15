/**
 * Build the `externalControls` block of a page's map config - the serialisable options the
 * external-controls plugin (`public/javascripts/external-controls-plugin.mjs`) reads to bind
 * form controls outside the map to datasets-plugin features.
 *
 * The binding convention: a control's `value` equals the bound feature's `idProperty` value.
 * On the boundary page both are the case_boundary id, so a radio literally names its
 * shapefile. The demo page (/map-external-controls-demo) uses the same builder; adopting the
 * plugin on a real page is emitting this block into that page's map config.
 */

/** One external control's link to a map feature - see the plugin's JSDoc for the contract. */
export interface ExternalControlsBinding {
	/** The input's value attribute - the link key. */
	value: string;
	/** The feature's idProperty value (=== value by convention). */
	featureId: string;
	/** The dataset's idProperty. */
	idProperty: string;
	/** The datasets-plugin dataset id (used for visibility and opacity). */
	datasetId: string;
	/** The interact layerId used for the selection highlight. */
	layerId: string;
}

/** The `externalControls` map-config block - serialisable (no functions, no DOM refs). */
export interface ExternalControlsConfig {
	/** CSS selector matching the bound inputs - scope it when a page has more than one group. */
	control: string;
	bindings: ExternalControlsBinding[];
	/**
	 * What the map does beyond selecting the shape: 'select' (selection ring only),
	 * 'solo' (hide the other bound datasets) or 'dim' (fade them to dimOpacity).
	 */
	emphasis?: 'select' | 'solo' | 'dim';
	/** Force the chosen dataset visible so the highlight is never hidden. Default true. */
	ensureVisible?: boolean;
	/** The other bound datasets' opacity in 'dim' mode. Default 0.25. */
	dimOpacity?: number;
	/** 'always' fits the view to the chosen shape; 'never' (default) leaves it alone. */
	zoomTo?: 'never' | 'always';
	/**
	 * Re-assert the checked control's highlight when the map deselects (default true) -
	 * the radio is the form answer, so the highlight tracks it.
	 */
	persistent?: boolean;
	/**
	 * 'shared' (default) keeps bound datasets in the map's Layers menu beside the external
	 * controls; 'external' removes them so the external controls are the only per-file control.
	 */
	primaryControl?: 'shared' | 'external';
}

export interface ExternalControlsConfigOptions extends Omit<ExternalControlsConfig, 'control' | 'bindings'> {
	/** CSS selector matching the bound inputs, e.g. `'#confirm-shapefile input[name="shapefile"]'`. */
	control: string;
	/** The datasets' idProperty (default 'fileKey', the boundary page's). */
	idProperty?: string;
	/** The datasets' id prefix (default 'shapefile-', matching maps/boundary-map.ts). */
	datasetIdPrefix?: string;
}

/**
 * One binding per file: `value`/`featureId` are the file's id, and the dataset/layer ids are
 * `'shapefile-<id>'` - the ids `buildBoundaryMapConfig` and `buildDatasets` already produce.
 */
export function buildExternalControlsConfig(
	files: { id: string }[],
	options: ExternalControlsConfigOptions
): ExternalControlsConfig {
	const { control, idProperty = 'fileKey', datasetIdPrefix = 'shapefile-', ...behaviour } = options;
	return {
		control,
		bindings: files.map((file) => ({
			value: file.id,
			featureId: file.id,
			idProperty,
			datasetId: `${datasetIdPrefix}${file.id}`,
			layerId: `${datasetIdPrefix}${file.id}`
		})),
		...behaviour
	};
}
