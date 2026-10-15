/**
 * "External controls" plugin for the Defra Interactive Map: two-way binding between
 * ordinary form controls outside the map component (GOV.UK radios) and features drawn
 * by the datasets plugin.
 *
 * The use case is the project boundary page's "Confirm shapefile for report" radios:
 * picking a radio highlights that file's shape on the map, and clicking a shape on the
 * map checks the matching radio. The radios stay plain form fields - they still submit
 * normally and still work without JavaScript (the map simply does not react).
 *
 * Usage mirrors the other plugins - register it last, after datasets and interact:
 *
 *   const datasets = buildDatasets(config);
 *   const datasetsPlugin = defra.datasetsPlugin({ datasets, hasMenu: false });
 *   const interactPlugin = defra.interactPlugin({ interactionModes: ['selectFeature'], layers });
 *   const externalControls = createExternalControlsPlugin({
 *     control: '#confirm-shapefile input[name="shapefile"]',
 *     bindings,
 *     datasets
 *   });
 *   new defra.InteractiveMap(mapId, { ..., plugins: [datasetsPlugin, interactPlugin, externalControls] });
 *
 * ## The binding data structure
 *
 * One binding per control, linking a form value to a map feature. The link convention:
 * the input's `value` equals the bound feature's `idProperty` value - on the boundary
 * page `value`/`fileKey` are both the case_boundary id, so a radio literally names its
 * feature. Server-side, `maps/external-controls-config.ts` emits this block.
 *
 *   {
 *     value: 'file-a',                  // the input's value attribute - the link key
 *     featureId: 'file-a',             // the feature's idProperty value (=== value by convention)
 *     idProperty: 'fileKey',           // the dataset's idProperty
 *     datasetId: 'shapefile-file-a',   // datasets-plugin dataset id (visibility/opacity)
 *     layerId: 'shapefile-file-a'      // interact layerId used for the selection highlight
 *   }
 *
 * ## Options (pluginConfig)
 *
 * - `control`        CSS selector matching the bound inputs. Scope it (e.g. by wrapping
 *                    form id) when a page has more than one bound group.
 * - `bindings`       the array above (required).
 * - `datasets`       the same array passed to datasetsPlugin - resolves each binding's
 *                    geometry for `zoomTo` and receives the `primaryControl` mutation.
 * - `emphasis`       what the map does beyond selecting the shape:
 *                    'select' (default) - the interact selection ring only;
 *                    'solo'   - hide every other bound dataset (setDatasetVisibility);
 *                    'dim'    - leave all visible but setOpacity(dimOpacity) on the others.
 * - `ensureVisible`  default true: the chosen dataset is force-shown so the highlight is
 *                    never behind an unticked layer.
 * - `dimOpacity`     opacity the other bound datasets take in 'dim' mode (default 0.25).
 * - `zoomTo`         'never' (default) | 'always' - mapProvider.fitToBounds the feature.
 * - `persistent`     default true: when the map deselects (e.g. click outside) the
 *                    checked control's highlight is re-asserted - the radio is the
 *                    answer, so the highlight tracks it. false leaves the map cleared.
 * - `primaryControl` 'shared' (default) | 'external'. 'shared' leaves bound datasets in
 *                    the map's Layers menu beside the radios; 'external' sets
 *                    showInMenu:false on them IN THE FACTORY (it mutates the shared
 *                    `datasets` array before InteractiveMap construction), so the radios
 *                    are the only per-file control.
 *
 * ## Gotchas this plugin handles
 *
 * - interact's selectFeature is a *toggle*: selecting the already-selected feature
 *   unselects it. The plugin tracks selection (speculative marks + selectionchange)
 *   and never re-selects the current feature.
 * - No map API is safe before the datasets plugin is up: `setDatasetVisibility`
 *   before SET_DATASETS logs "Dataset not found", and enabling interact before the
 *   MapLibre instance exists crashes its visible-features effect. The plugin waits
 *   for `datasets:ready` (fired after the datasets are registered AND the adapter
 *   has initialised) - or `app:ready` when no `datasets` are configured - before
 *   touching anything. A control checked during boot is picked up by the replay,
 *   because the DOM keeps the checked state.
 * - `interact:selectFeature` emits are dropped when interact is not enabled, so an
 *   emit sent while `interact:active` has not fired is tracked as *speculative*;
 *   the next `interact:active` clears the mark and replays it. An emit that did
 *   land is confirmed by `interact:selectionchange`.
 * - Radios can't be unchecked - when the map deselects, the radio keeps its answer;
 *   `persistent` decides whether the highlight snaps back.
 * - Checking a radio from the map sets input.checked without dispatching `change`
 *   (the binding itself would be the only listener - the loop is avoided by design).
 * - The framework memoises plugin components in a module-level cache keyed on the
 *   component's identity, capturing `pluginConfig` on first use. A shared manifest
 *   would give every map on the page the first map's config, so the factory returns
 *   a fresh manifest - fresh component identity - per call, and the component binds
 *   that call's options rather than the (possibly cached) pluginConfig prop.
 * - Keep ONE interactive map per page. The datasets plugin's datasetRegistry and
 *   layerAdapter are module-level singletons shared by every map on the page:
 *   visibility/opacity api calls run against whichever map initialised last, so
 *   two maps sharing dataset ids cross-talk (a Layers-menu toggle can apply to
 *   the wrong map). That is also why the demo page renders a single map per mode.
 *
 * Known limitation with primaryControl 'shared': a dataset the user unticked in the
 * Layers panel is force-shown by ensureVisible, but our layers-key panel caches its
 * rows' checked state, so its checkbox can look stale until reopened. 'external'
 * avoids the divergence by removing the rows.
 *
 * The file is `.mjs`, not `.js`: the build fingerprints `javascripts/*.js` (content-hash
 * renames the file), so modules importing this one need a specifier that step leaves alone.
 */

const DEFAULT_DIM_OPACITY = 0.25;

/**
 * Inputs matching a CSS selector, limited to actual input elements.
 *
 * @param {string | undefined} selector
 * @param {ParentNode} root
 * @returns {HTMLInputElement[]}
 */
export function controlInputs(selector, root = globalThis.document) {
	if (!selector || !root) {
		return [];
	}
	return [...root.querySelectorAll(selector)].filter((el) => el.tagName === 'INPUT');
}

/**
 * The binding a control value points at.
 *
 * @param {object[]} bindings
 * @param {unknown} value
 * @returns {object | undefined}
 */
export function bindingForValue(bindings, value) {
	return bindings.find((binding) => binding.value === value);
}

/**
 * True when a selectionchange feature entry is this binding's feature. The featureId
 * carries the idProperty value; layerId matches the bound layer or its `-stroke`
 * sibling (the datasets plugin draws fills and outlines as separate MapLibre layers).
 *
 * @param {object | undefined} feature - a selectedFeatures entry: {featureId, layerId, properties}
 * @param {object} binding
 * @returns {boolean}
 */
export function featureMatchesBinding(feature, binding) {
	if (!feature) {
		return false;
	}
	if (
		feature.layerId &&
		binding.layerId &&
		feature.layerId !== binding.layerId &&
		feature.layerId !== `${binding.layerId}-stroke`
	) {
		return false;
	}
	if (feature.featureId != null && String(feature.featureId) === String(binding.featureId)) {
		return true;
	}
	return feature.properties?.[binding.idProperty] === binding.value;
}

/**
 * The GeoJSON feature a binding points at - for zoomTo (fitToBounds takes a Feature).
 *
 * @param {object[]} datasets
 * @param {object} binding
 * @returns {object | undefined}
 */
export function featureForBinding(datasets, binding) {
	const dataset = datasets.find((entry) => entry.id === binding.datasetId);
	return dataset?.geojson?.features?.find((feature) => feature?.properties?.[binding.idProperty] === binding.featureId);
}

/**
 * Push a control's selection to the map: force the dataset visible (unless
 * ensureVisible is off), apply the emphasis mode to the other bound datasets,
 * select the feature (skipped when it is already selected - selectFeature toggles),
 * and optionally fit the view to it.
 *
 * `selection` is the plugin's tracked map selection ({features: []}). The emitted
 * entry is marked `speculative` when interact is not known to be listening - a
 * dropped emit can then be cleared and re-sent on `interact:active`.
 *
 * @param {object} args
 * @param {object} args.binding
 * @param {object[]} args.bindings
 * @param {object[]} args.datasets
 * @param {object} args.pluginConfig
 * @param {object} args.services - plugin context services (eventBus, getPlugin)
 * @param {object | undefined} args.mapProvider
 * @param {{ features: object[] }} args.selection
 * @param {boolean} [args.interactActive] - the interact plugin has emitted interact:active
 */
export function applySelection({
	binding,
	bindings,
	datasets,
	pluginConfig,
	services,
	mapProvider,
	selection,
	interactActive
}) {
	const { eventBus, getPlugin } = services ?? {};
	const datasetsApi = getPlugin?.('datasets');
	const emphasis = pluginConfig.emphasis ?? 'select';

	if (pluginConfig.ensureVisible !== false) {
		datasetsApi?.setDatasetVisibility?.(true, { datasetId: binding.datasetId });
	}

	for (const other of bindings) {
		if (other === binding) {
			continue;
		}
		if (emphasis === 'solo') {
			datasetsApi?.setDatasetVisibility?.(false, { datasetId: other.datasetId });
		} else if (emphasis === 'dim') {
			datasetsApi?.setOpacity?.(pluginConfig.dimOpacity ?? DEFAULT_DIM_OPACITY, { datasetId: other.datasetId });
		}
	}
	if (emphasis === 'dim') {
		const originalOpacity = datasets.find((entry) => entry.id === binding.datasetId)?.opacity ?? 1;
		datasetsApi?.setOpacity?.(originalOpacity, { datasetId: binding.datasetId });
	}

	// resolve the dataset's own copy of the feature: the interact reducer stores any
	// properties/geometry we emit with the selection, and click selection would have
	// enriched them - emitting them here keeps `interact:selectionchange` listeners
	// (e.g. the feature-details panel) seeing a full feature either way
	const feature = featureForBinding(datasets, binding);
	if (!selection.features.some((entry) => featureMatchesBinding(entry, binding))) {
		// mark it now so a repeat call before selectionchange lands can't double-toggle;
		// the mark is speculative while interact may not be listening - `interact:active`
		// clears speculative marks and replays the checked control's binding
		selection.features = [
			{
				featureId: binding.featureId,
				layerId: binding.layerId,
				idProperty: binding.idProperty,
				properties: feature?.properties,
				geometry: feature?.geometry,
				speculative: !interactActive
			}
		];
		eventBus?.emit?.('interact:selectFeature', {
			featureId: binding.featureId,
			layerId: binding.layerId,
			idProperty: binding.idProperty,
			properties: feature?.properties,
			geometry: feature?.geometry
		});
	}

	if (pluginConfig.zoomTo === 'always' && feature) {
		mapProvider?.fitToBounds?.(feature);
	}
}

/**
 * Push the map's selection to the controls: when a bound feature is selected, check
 * its input. An empty selection leaves the radios alone (they can't be unchecked) -
 * with `persistent` the checked control's highlight is re-applied instead.
 *
 * @param {object} args
 * @param {object[]} args.selectedFeatures
 * @param {object[]} args.bindings
 * @param {HTMLInputElement[]} args.inputs
 * @param {object} args.pluginConfig
 * @param {{ features: object[] }} args.selection
 * @param {(binding: object) => void} args.applyToMap
 */
export function syncControlsFromSelection({ selectedFeatures, bindings, inputs, pluginConfig, selection, applyToMap }) {
	selection.features = selectedFeatures;
	for (const feature of selectedFeatures) {
		const binding = bindings.find((candidate) => featureMatchesBinding(feature, candidate));
		if (binding) {
			const input = inputs.find((candidate) => candidate.value === binding.value);
			if (input) {
				input.checked = true;
			}
			return;
		}
	}
	if (selectedFeatures.length === 0 && pluginConfig.persistent !== false) {
		const checked = inputs.find((input) => input.checked);
		const binding = checked ? bindingForValue(bindings, checked.value) : undefined;
		if (binding) {
			applyToMap(binding);
		}
	}
}

/**
 * Headless plugin component - no UI of its own; it just wires the two directions:
 * DOM `change` -> map selection/emphasis, and `interact:selectionchange` -> checked.
 * Returns null like the interact plugin's own InteractInit.
 */
function ExternalControlsInit({ pluginConfig, services, mapProvider }) {
	const { useEffect, useRef } = globalThis.preactCompat;
	const selectionRef = useRef({ features: [] });

	useEffect(() => {
		const bindings = pluginConfig.bindings ?? [];
		const inputs = controlInputs(pluginConfig.control);
		const { eventBus, getPlugin } = services ?? {};
		if (bindings.length === 0 || inputs.length === 0) {
			return undefined;
		}

		const selection = selectionRef.current;

		// nothing is safe until the datasets plugin has registered its datasets and the
		// map exists: `datasets:ready` fires after SET_DATASETS and the adapter's init,
		// which implies the MapLibre instance is up. When no datasets are configured
		// `app:ready` is enough - the datasets api calls are all absent anyway.
		let ready = false;
		let interactActive = false;

		// no-op before `ready`: the checked input itself is the pending state - the
		// next readiness event replays whatever is checked then
		const applyToMap = (binding) => {
			if (!ready) {
				return;
			}
			applySelection({
				binding,
				bindings,
				datasets: pluginConfig.datasets ?? [],
				pluginConfig,
				services,
				mapProvider,
				selection,
				interactActive
			});
		};

		// a control checked before the map was ready (or restored by bfcache) still
		// applies - the DOM keeps the checked state for the replay to read
		const syncCheckedControl = () => {
			if (!ready) {
				return;
			}
			getPlugin?.('interact')?.enable?.();
			const checked = inputs.find((input) => input.checked);
			const binding = checked ? bindingForValue(bindings, checked.value) : undefined;
			if (binding) {
				applyToMap(binding);
			}
		};

		const onChange = (event) => {
			if (event.target.checked && bindingForValue(bindings, event.target.value)) {
				syncCheckedControl();
			}
		};
		const onSelectionChange = (event) => {
			syncControlsFromSelection({
				selectedFeatures: event?.selectedFeatures ?? [],
				bindings,
				inputs,
				pluginConfig,
				selection,
				applyToMap
			});
		};
		const onDatasetsReady = () => {
			ready = true;
			syncCheckedControl();
		};
		const onAppReady = () => {
			if ((pluginConfig.datasets ?? []).length === 0) {
				onDatasetsReady();
			}
		};
		const onInteractActive = (event) => {
			interactActive = event?.active !== false;
			// emits sent while interact was inactive may never have landed - drop their
			// speculative marks so the replay re-sends rather than skipping them
			selection.features = selection.features.filter((entry) => !entry.speculative);
			syncCheckedControl();
		};

		for (const input of inputs) {
			input.addEventListener('change', onChange);
		}
		eventBus?.on?.('interact:selectionchange', onSelectionChange);
		eventBus?.on?.('interact:active', onInteractActive);
		eventBus?.on?.('datasets:ready', onDatasetsReady);
		eventBus?.on?.('app:ready', onAppReady);

		return () => {
			for (const input of inputs) {
				input.removeEventListener('change', onChange);
			}
			eventBus?.off?.('interact:selectionchange', onSelectionChange);
			eventBus?.off?.('interact:active', onInteractActive);
			eventBus?.off?.('datasets:ready', onDatasetsReady);
			eventBus?.off?.('app:ready', onAppReady);
		};
	}, [services, mapProvider, pluginConfig]);

	return null;
}

/**
 * @param {object} [options] - see the file header for the full config reference
 * @param {string} [options.control] - CSS selector matching the bound inputs
 * @param {object[]} [options.bindings] - control value -> map feature links
 * @param {object[]} [options.datasets] - the array passed to datasetsPlugin
 * @param {string} [options.emphasis] - 'select' (default) | 'solo' | 'dim'
 * @param {boolean} [options.ensureVisible] - force the chosen dataset visible (default true)
 * @param {number} [options.dimOpacity] - other datasets' opacity in 'dim' mode (default 0.25)
 * @param {string} [options.zoomTo] - 'never' (default) | 'always'
 * @param {boolean} [options.persistent] - re-assert the checked control's selection (default true)
 * @param {string} [options.primaryControl] - 'shared' (default) | 'external'
 * @returns {object} PluginDescriptor for InteractiveMap's `plugins` option
 */
export function createExternalControlsPlugin(options = {}) {
	const bindings = options.bindings ?? [];

	// 'external' primary control: bound datasets leave the map's Layers menu entirely.
	// This mutates the shared datasets array, so it must run before the InteractiveMap
	// is constructed - the factory is the right place (plugin init is too late to matter
	// anyway: the menus read showInMenu lazily, at render time).
	if (options.primaryControl === 'external') {
		const boundDatasetIds = new Set(bindings.map((binding) => binding.datasetId));
		for (const dataset of options.datasets ?? []) {
			if (boundDatasetIds.has(dataset.id)) {
				dataset.showInMenu = false;
				for (const sublayer of dataset.sublayers ?? []) {
					sublayer.showInMenu = false;
				}
			}
		}
	}

	// The map framework memoises each plugin's wrapped InitComponent in a
	// module-level cache keyed on the component's identity, capturing the
	// pluginConfig prop the first time it is seen. A single shared manifest
	// would therefore hand every map on the page the first map's config - on
	// this page all three instances would bind the first map's control
	// selector. So each factory call returns a fresh manifest whose component
	// identity is unique to the call, and the component binds this call's
	// `options` rather than trusting a pluginConfig prop that may have been
	// captured for a different map.
	const manifest = {
		InitComponent: function ExternalControlsInitBound(props) {
			const compat = globalThis.preactCompat;
			return compat?.createElement
				? compat.createElement(ExternalControlsInit, { ...props, pluginConfig: options })
				: null;
		}
	};

	return {
		...options,
		id: 'externalControls',
		load: async () => manifest
	};
}
