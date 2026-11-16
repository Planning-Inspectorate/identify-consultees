/**
 * "Selected on the map" feature-details plugin for the Defra Interactive Map.
 *
 * Click an area or point and a panel says what it is - a consultee's name,
 * category and region, or the project site's name and reference - and, when the
 * page config carries `consulteeActions` URLs (the category pages'), how to act
 * on it: a nearby-only consultee (`identified: 'false'`) gets an Add link to the
 * "Add a consultee" page, its name prefilled; an identified one gets a Remove
 * link to the "Remove consultee" page, targeting it as its `removeTarget`
 * property names it (a ruleset `match` id, or a hand-added consultee's `added`
 * index - the same targets the category page's table rows use). Clicking away
 * closes the panel and clears the selection.
 *
 *   const featureDetailsPlugin = createFeatureDetailsPlugin(config.consulteeActions);
 *   const map = new defra.InteractiveMap(mapId, { ..., plugins: [..., featureDetailsPlugin] });
 *   featureDetailsPlugin.wire(map, interactPlugin);
 *
 * Like static-map-plugin, the panel is driven through the component's runtime
 * API (`map.addPanel`, `map.on`) rather than a manifest panel, so `wire` is a
 * helper on the descriptor - `load` only needs to satisfy the plugin contract.
 *
 * The file is `.mjs`, not `.js`: the build fingerprints `javascripts/*.js`
 * (content-hash renames the file), so modules importing this one need a
 * specifier that step leaves alone.
 */

const PANEL_ID = 'consultee-details';

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/**
 * The selected consultee's action link: Add for one only the nearby search found
 * (identified 'false'), its Add a consultee page opening with the name entered;
 * Remove for one in the report, its `removeTarget` completing the page URL.
 * Anything else - the project site, or a map with no consulteeActions config -
 * has none.
 *
 * @param {object} properties
 * @param {object} actions
 * @param {string | undefined} actions.addUrl - the "Add a consultee" page; `&name=` is appended
 * @param {string | undefined} actions.removeUrl - the "Remove consultee" page; `&<removeTarget>` is appended
 * @returns {string}
 */
function actionLinkHtml(properties, { addUrl, removeUrl }) {
	if (!properties.consulteeId) {
		return '';
	}
	if (properties.identified === 'false') {
		return addUrl
			? `<p class="govuk-body-s govuk-!-margin-bottom-0"><a class="govuk-link" href="${escapeHtml(addUrl)}&amp;name=${encodeURIComponent(properties.name || '')}">Add</a></p>`
			: '';
	}
	const target = properties.removeTarget;
	return removeUrl && target
		? `<p class="govuk-body-s govuk-!-margin-bottom-0"><a class="govuk-link" href="${escapeHtml(removeUrl)}&amp;${escapeHtml(target)}">Remove</a></p>`
		: '';
}

/**
 * The details panel's HTML for a selected feature: a consultee's name, category
 * and region, or the project site's name and reference - then its add/remove
 * action link, when the page gave the panel its page URLs.
 *
 * @param {object} properties
 * @param {object} [actions] - `consulteeActions` from the page's map config
 * @returns {string}
 */
export function featureDetailsHtml(properties, actions = {}) {
	const rows = properties.consulteeId
		? [
				['Category', properties.consulteeCategory],
				['Region', properties.region]
			]
		: [['Reference', properties.reference]];
	return (
		`<p class="govuk-body govuk-!-font-weight-bold govuk-!-margin-bottom-2">${escapeHtml(properties.name || 'Unnamed')}</p>` +
		rows
			.filter(([, value]) => value)
			.map(([label, value]) => `<p class="govuk-body-s govuk-!-margin-bottom-1">${label}: ${escapeHtml(value)}</p>`)
			.join('') +
		actionLinkHtml(properties, actions)
	);
}

/**
 * @param {object} map - InteractiveMap instance
 * @param {object} interactPlugin
 * @param {object} actions - `consulteeActions` from the page's map config
 */
function wireFeatureDetails(map, interactPlugin, actions) {
	map.on('map:ready', () => {
		// the core attaches enable etc. to the plugin when it mounts, so not before map:ready
		interactPlugin.enable();
		map.addPanel(PANEL_ID, {
			focus: false,
			label: 'Selected on the map',
			html: `<div id="${PANEL_ID}-content"></div>`,
			mobile: { slot: 'drawer', dismissible: true },
			tablet: { slot: 'left-top', dismissible: true, width: '300px' },
			desktop: { slot: 'left-top', dismissible: true, width: '300px' }
		});
		map.hidePanel(PANEL_ID);
	});
	map.on('interact:selectionchange', ({ selectedFeatures }) => {
		if (selectedFeatures.length > 0) {
			document.getElementById(`${PANEL_ID}-content`).innerHTML = featureDetailsHtml(
				selectedFeatures[0].properties,
				actions
			);
			map.showPanel(PANEL_ID);
		} else {
			map.hidePanel(PANEL_ID);
		}
	});
	map.on('app:panelclosed', ({ panelId }) => {
		if (panelId === PANEL_ID) {
			interactPlugin.clear();
		}
	});
}

// the panel lives entirely in the runtime API calls `wire` makes, so the
// manifest is intentionally empty - the descriptor carries the config and the
// helper the page bootstrap calls once it has the map and interact plugin
const manifest = {};

/**
 * @param {object} [options] - `consulteeActions` from the page's map config
 * @param {string} [options.addUrl] - the "Add a consultee" page; a nearby-only
 *   consultee's link appends `&name=<its name>`
 * @param {string} [options.removeUrl] - the "Remove consultee" page; an
 *   identified consultee's link appends `&<its removeTarget>` (`match=` or
 *   `added=`, as the category page's table rows target it)
 * @returns {object} PluginDescriptor for InteractiveMap's `plugins` option, with
 *   a `wire(map, interactPlugin)` helper connecting the details panel
 */
export function createFeatureDetailsPlugin(options = {}) {
	return {
		id: 'featureDetails',
		load: async () => manifest,
		wire: (map, interactPlugin) => wireFeatureDetails(map, interactPlugin, options)
	};
}
