/**
 * "Key" tab inside the datasets plugin's built-in Layers panel - replaces the
 * former layers-key plugin, using the component's slot system instead.
 *
 * A control whose breakpoint slot is '<panel-id>-panel' renders inside that
 * panel's body (the docs' "Panel-Injected Controls"), and giving it a `tab`
 * splits the body into tabs ("Panel Tabs"): the built-in checkbox menu keeps
 * the implicit tab labelled with the panel's own label ("Layers"), and this
 * control lands on "Key".
 *
 * The map-key bundle must be loaded but the plugin is not registered: its own
 * button and panel are unwanted. `load()` is called only to fetch its panel's
 * render component - MapKey wires itself to the datasets registry on mount
 * (it calls eventBus.requestOnce('datasets:registry') itself when the
 * MapKeyInit component has not run), so registering the plugin just to hide
 * its button and panel again is unnecessary.
 *
 *   const mapKey = defra.mapKeyPlugin?.();
 *   const map = new defra.InteractiveMap(mapId, { ..., plugins: [datasetsPlugin] });
 *   map.on('map:ready', () => injectLayersKeyTab(map, mapKey));
 *
 * The file is `.mjs`, not `.js`: the build fingerprints `javascripts/*.js`
 * (content-hash renames the file), so modules importing this one need a
 * specifier that step leaves alone.
 *
 * If the map-key bundle, its manifest shape or `window.preactCompat` (exposed
 * by the map's UMD bundle) is unavailable, this quietly does nothing - the map
 * keeps the built-in Layers menu.
 */

// slot a control targets to land inside the datasets plugin's Layers panel body:
// the panel's id ('datasetsLayers') kebab-cased, suffixed '-panel'
const LAYERS_PANEL_SLOT = 'datasets-layers-panel';
const KEY_TAB_LABEL = 'Key';

/**
 * @param {object} map - InteractiveMap instance (call from a `map:ready` handler)
 * @param {object | undefined} mapKeyPlugin - `defra.mapKeyPlugin()` descriptor; used for
 *   `load()` (the panel's render component) and as the `pluginConfig` MapKey expects
 *   (`noKeyItemText`, `groups`)
 */
export async function injectLayersKeyTab(map, mapKeyPlugin) {
	const compat = globalThis.preactCompat;
	if (!mapKeyPlugin?.load || !compat?.createElement) {
		return;
	}
	try {
		const manifest = await mapKeyPlugin.load();
		const MapKey = manifest.panels?.find((panel) => panel.id === 'mapKey')?.render;
		if (!MapKey) {
			return;
		}
		map.addControl('layersKey', {
			id: 'layersKey',
			label: KEY_TAB_LABEL,
			render: (props) => compat.createElement(MapKey, { ...props, pluginConfig: mapKeyPlugin }),
			mobile: { slot: LAYERS_PANEL_SLOT, tab: KEY_TAB_LABEL },
			tablet: { slot: LAYERS_PANEL_SLOT, tab: KEY_TAB_LABEL },
			desktop: { slot: LAYERS_PANEL_SLOT, tab: KEY_TAB_LABEL }
		});
	} catch {
		// the map-key chunk or manifest lookup failed - the built-in Layers menu still works
	}
}
