/**
 * "Selected row" wiring between a category page's consultees table and the map:
 * clicking a row selects its consultee on the map (the selection ring and the
 * "Selected on the map" panel appear), and selecting a consultee feature on the
 * map greys its row - the two stay mirrors of each other so a user can find a
 * consultee on the map from the list, or find its row from the map.
 *
 * A row names its feature with `data-consultee-id` on its bulk-removal checkbox
 * - the same id the map's features carry as `consulteeId` (the dataset's
 * idProperty, so also the featureId `interact:selectionchange` reports). Rows
 * without one - a consultee added by name alone has nothing on the map - can't
 * be clicked, and selecting a feature no row names (a nearby-only consultee,
 * the project site) just un-greys.
 *
 * Clicks on the controls inside a row stay that control's job, not a selection:
 * the checkbox toggles for bulk removal and the Remove link navigates. A second
 * click on the selected row deselects it, mirroring the map's click-to-deselect.
 *
 * Selecting programmatically needs the interact plugin enabled -
 * feature-details-plugin enables it at `map:ready`, so a row clicked while the
 * map is still starting (the table renders long before it is) is remembered and
 * replayed on `interact:active`.
 *
 *   const featureRowSelectPlugin = createFeatureRowSelectPlugin({ datasets });
 *   featureRowSelectPlugin.wire(map, interactPlugin);
 *
 * `wire` no-ops when the page has no consultees table (the boundary page), so
 * the plugin can be registered unconditionally. Like feature-details-plugin,
 * the behaviour lives in `wire`'s runtime calls rather than a manifest.
 *
 * The file is `.mjs`, not `.js`: the build fingerprints `javascripts/*.js`
 * (content-hash renames the file), so modules importing this one need a
 * specifier that step leaves alone.
 */

const TABLE_SELECTOR = '.pins-consultees-table';
const ROW_INPUT = 'input[data-consultee-id]';
const CONSULTEE_DATASET_ID = 'consultee-areas';
// a click landing on a control inside a row is that control's job, not a row
// selection - the checkbox marks for bulk removal, the Remove link navigates
const INTERACTIVE = 'a, button, input, label, select, textarea';
export const SELECTED_ROW_CLASS = 'pins-consultee-row--selected';

/**
 * The consultee dataset's copy of the feature a consultee id names - emitted
 * with a programmatic select so `interact:selectionchange` listeners see the
 * same properties and geometry a map click would carry.
 *
 * @param {object[]} datasets - the array passed to datasetsPlugin
 * @param {string} consulteeId
 * @returns {{ dataset: object, feature: object } | undefined}
 */
export function consulteeFeature(datasets, consulteeId) {
	const dataset = datasets.find((entry) => entry.id === CONSULTEE_DATASET_ID);
	const feature = dataset?.geojson?.features?.find(
		(entry) => String(entry?.properties?.consulteeId) === String(consulteeId)
	);
	return feature ? { dataset, feature } : undefined;
}

/**
 * Evaluate the simple filter expressions `buildCategorySublayers` emits -
 * 'all'/'any'/'=='/'!=' over `['get', <property>]` - against a feature's
 * properties, to find which sublayer draws it.
 *
 * @param {unknown} filter - a sublayer's `filter` expression
 * @param {object} properties
 * @returns {boolean}
 */
export function filterMatches(filter, properties) {
	if (!Array.isArray(filter)) {
		return true;
	}
	const [op, ...rest] = filter;
	if (op === 'all') {
		return rest.every((entry) => filterMatches(entry, properties));
	}
	if (op === 'any') {
		return rest.some((entry) => filterMatches(entry, properties));
	}
	if (op === '==' || op === '!=') {
		const value = Array.isArray(rest[0]) && rest[0][0] === 'get' ? properties[rest[0][1]] : rest[0];
		return op === '==' ? value === rest[1] : value !== rest[1];
	}
	return false;
}

/**
 * The layerId a programmatic select should report for a feature - the same one
 * a click records (`<dataset.id>-<sublayer.id>` for the sublayer whose filter
 * matches, a plain dataset's own id when it has no sublayers). A feature
 * matching no sublayer falls back to the first: the sublayers share the
 * dataset's single source, so the highlight resolves it regardless.
 *
 * @param {{ dataset: object, feature: object }} found - consulteeFeature's result
 * @returns {string}
 */
export function layerForFeature({ dataset, feature }) {
	if (!dataset.sublayers?.length) {
		return dataset.id;
	}
	const sublayer = dataset.sublayers.find((entry) => filterMatches(entry.filter, feature.properties));
	return `${dataset.id}-${(sublayer ?? dataset.sublayers[0]).id}`;
}

/**
 * The table row for a consultee id, found through its checkbox's
 * `data-consultee-id` - compared as strings so numeric ids still match.
 *
 * @param {Element} tbody
 * @param {unknown} consulteeId
 * @returns {Element | undefined}
 */
export function rowForConsultee(tbody, consulteeId) {
	if (consulteeId == null) {
		return undefined;
	}
	for (const input of tbody.querySelectorAll(ROW_INPUT)) {
		if (String(input.dataset.consulteeId) === String(consulteeId)) {
			return input.closest('tr');
		}
	}
	return undefined;
}

/**
 * Mirror the map's selection onto the rows: only the selected feature's row
 * greys; an empty or unlisted selection un-greys them all.
 *
 * @param {Element} tbody
 * @param {object[]} selectedFeatures - `interact:selectionchange` entries
 */
export function syncRowFromSelection(tbody, selectedFeatures) {
	for (const row of tbody.querySelectorAll(`tr.${SELECTED_ROW_CLASS}`)) {
		row.classList.remove(SELECTED_ROW_CLASS);
	}
	rowForConsultee(tbody, selectedFeatures[0]?.featureId)?.classList.add(SELECTED_ROW_CLASS);
}

/**
 * @param {object} map - InteractiveMap instance (its `eventBus` emits the select)
 * @param {object} interactPlugin - cleared to deselect
 * @param {object} options
 * @param {object[]} options.datasets - the array passed to datasetsPlugin
 */
function wireFeatureRowSelect(map, interactPlugin, { datasets }) {
	const tbody = document.querySelector(TABLE_SELECTOR)?.tBodies?.[0];
	if (!tbody) {
		return;
	}

	let interactActive = false;
	// the consultee id the map's selection is or should be on - marked on a row
	// click so a second click inside the round-trip toggles rather than
	// re-emitting (interact's selectFeature toggles), confirmed on selectionchange
	let selectedId;
	// a row clicked before interact was enabled - replayed on interact:active
	let pendingId;

	const emitSelect = (consulteeId) => {
		const found = consulteeFeature(datasets, consulteeId);
		if (!found) {
			return;
		}
		map.eventBus.emit('interact:selectFeature', {
			featureId: consulteeId,
			layerId: layerForFeature(found),
			idProperty: 'consulteeId',
			properties: found.feature.properties,
			geometry: found.feature.geometry
		});
	};

	tbody.addEventListener('click', (event) => {
		if (event.target.closest(INTERACTIVE)) {
			return;
		}
		const consulteeId = event.target.closest('tr')?.querySelector(ROW_INPUT)?.dataset.consulteeId;
		if (!consulteeId) {
			return;
		}
		if (consulteeId === selectedId) {
			selectedId = undefined;
			pendingId = undefined;
			if (interactActive) {
				interactPlugin.clear();
			}
		} else {
			selectedId = consulteeId;
			if (interactActive) {
				emitSelect(consulteeId);
			} else {
				pendingId = consulteeId;
			}
		}
	});

	map.on('interact:selectionchange', ({ selectedFeatures }) => {
		const featureId = selectedFeatures?.[0]?.featureId;
		selectedId = featureId == null ? undefined : String(featureId);
		syncRowFromSelection(tbody, selectedFeatures ?? []);
	});
	map.on('interact:active', ({ active }) => {
		interactActive = active !== false;
		if (interactActive && pendingId) {
			emitSelect(pendingId);
			pendingId = undefined;
		}
	});
}

// the behaviour lives entirely in the runtime calls `wire` makes, so the
// manifest is intentionally empty - the descriptor carries the config and the
// helper the page bootstrap calls once it has the map and interact plugin
const manifest = {};

/**
 * @param {object} [options]
 * @param {object[]} [options.datasets] - the same array passed to datasetsPlugin:
 *   a row click re-emits its feature's properties/geometry with the select
 * @returns {object} PluginDescriptor for InteractiveMap's `plugins` option, with
 *   a `wire(map, interactPlugin)` helper connecting the consultees table
 */
export function createFeatureRowSelectPlugin(options = {}) {
	return {
		id: 'featureRowSelect',
		load: async () => manifest,
		wire: (map, interactPlugin) => wireFeatureRowSelect(map, interactPlugin, options)
	};
}
