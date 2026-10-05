import { stringifyForInlineScript } from '#util/inline-json.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import type { Request } from 'express';
import {
	getInteractiveMapExample,
	INTERACTIVE_MAP_EXAMPLES,
	INTERACTIVE_MAP_OPENFREEMAP_ATTRIBUTION,
	INTERACTIVE_MAP_STYLE_URL,
	type InteractiveMapPluginId
} from '../../maps/interactive-map-examples.ts';
import { MAP_VIEWPORT } from '../../maps/sample-geojson.ts';
import { buildConsulteeStaticMapResponse } from '../../maps/serve-static-map.ts';
import type { InteractiveMapExamplesIndexViewModel, InteractiveMapExampleViewModel } from './view-model.ts';

const BASE_PATH = '/components/interactive-map';
const MAP_ID_PREFIX = 'interactive-map-example';

/**
 * Config-locals keys for each plugin's vendored bundles (populated by
 * `addLocalsConfiguration`; filenames are fingerprinted at build time).
 * Only the plugins a given example uses are emitted onto its page.
 */
const PLUGIN_ASSETS: Record<InteractiveMapPluginId, { js: string; css?: string }> = {
	datasets: { js: 'vendorDatasetsPluginJs', css: 'vendorDatasetsPluginCss' },
	'map-key': { js: 'vendorMapKeyPluginJs', css: 'vendorMapKeyPluginCss' },
	interact: { js: 'vendorInteractPluginJs' },
	draw: { js: 'vendorDrawPluginJs' },
	'map-styles': { js: 'vendorMapStylesPluginJs', css: 'vendorMapStylesPluginCss' }
};

const BEHAVIOUR_LABELS: Record<'inline' | 'buttonFirst' | 'hybrid', string> = {
	inline: 'Inline',
	buttonFirst: 'Button first',
	hybrid: 'Hybrid'
};

const PLUGIN_LABELS: Record<InteractiveMapPluginId, string> = {
	datasets: 'Datasets',
	'map-key': 'Map key',
	interact: 'Interact',
	draw: 'Draw',
	'map-styles': 'Map styles'
};

function componentsQuerySuffix(req: Request): string {
	return req.query.components === 'true' ? '?components=true' : '';
}

function pluginAssets(locals: Record<string, unknown>, plugins: readonly InteractiveMapPluginId[]) {
	const config = locals.config as Record<string, string> | undefined;
	const stylesheets = new Set<string>();
	const scripts = new Set<string>();
	for (const plugin of plugins) {
		const assets = PLUGIN_ASSETS[plugin];
		const css = assets.css ? config?.[assets.css] : undefined;
		const js = config?.[assets.js];
		if (css) {
			stylesheets.add(css);
		}
		if (js) {
			scripts.add(js);
		}
	}
	return { pluginStylesheets: [...stylesheets], pluginScripts: [...scripts] };
}

function pluginsLabel(plugins: readonly InteractiveMapPluginId[]): string {
	return plugins.length === 0 ? 'None' : plugins.map((plugin) => PLUGIN_LABELS[plugin]).join(', ');
}

/**
 * Index page listing every Defra Interactive Map example. Only reachable via
 * the `?components=true` showcase nav, like the rest of /components.
 */
export function buildInteractiveMapExamplesIndexPage(): AsyncRequestHandler {
	return async (req, res) => {
		const suffix = componentsQuerySuffix(req);

		const model: InteractiveMapExamplesIndexViewModel = {
			pageHeading: 'Interactive map',
			backLinkUrl: `/components${suffix}`,
			backLinkText: 'Back to components',
			examples: INTERACTIVE_MAP_EXAMPLES.map((example) => ({
				id: example.id,
				title: example.title,
				summary: example.summary,
				href: `${BASE_PATH}/${example.id}${suffix}`,
				behaviourLabel: BEHAVIOUR_LABELS[example.clientConfig.behaviour],
				pluginsLabel: pluginsLabel(example.plugins)
			}))
		};

		res.render('views/interactive-map-examples/view.njk', model);
	};
}

/**
 * Per-example page: accessible summary, interactive map (progressively
 * enhanced), and a cached server-rendered static map for no-JavaScript.
 */
export function buildInteractiveMapExamplePage(): AsyncRequestHandler {
	return async (req, res) => {
		const example = getInteractiveMapExample(String(req.params.example ?? ''));
		if (!example) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		const { clientConfig } = example;
		const { pluginStylesheets, pluginScripts } = pluginAssets(res.locals, example.plugins);

		const model: InteractiveMapExampleViewModel = {
			pageHeading: example.title,
			backLinkUrl: `${BASE_PATH}${componentsQuerySuffix(req)}`,
			backLinkText: 'Back to interactive map examples',
			summary: example.summary,
			interaction: example.interaction,
			mapId: `${MAP_ID_PREFIX}-${example.id}`,
			mapRegionLabel: clientConfig.mapLabel,
			staticMapSrc: `${BASE_PATH}/${example.id}/static-map`,
			staticMapAlt: example.staticMap.alt,
			mapWidth: MAP_VIEWPORT.width,
			mapHeight: MAP_VIEWPORT.height,
			mapConfigJson: stringifyForInlineScript({
				mapStyle: {
					url: INTERACTIVE_MAP_STYLE_URL,
					attribution: INTERACTIVE_MAP_OPENFREEMAP_ATTRIBUTION,
					backgroundColor: '#f5f5f0'
				},
				fallback: {
					src: `${BASE_PATH}/${example.id}/static-map`,
					alt: example.staticMap.alt,
					width: MAP_VIEWPORT.width,
					height: MAP_VIEWPORT.height
				},
				...clientConfig
			}),
			pluginStylesheets,
			pluginScripts,
			behaviourLabel: BEHAVIOUR_LABELS[clientConfig.behaviour],
			pluginsLabel: pluginsLabel(example.plugins)
		};

		res.render('views/interactive-map-examples/example.njk', model);
	};
}

/**
 * Heavily cached static fallback for an example. Content negotiation picks
 * AVIF → WebP → PNG from the Accept header; the explicit `.svg` route always
 * returns the vector variant. Shares the consultees static-map pipeline so
 * ETag/304 short-circuits before any upstream tile fetch.
 */
export function buildInteractiveMapStaticMap(forceSvg = false): AsyncRequestHandler {
	return async (req, res) => {
		const example = getInteractiveMapExample(String(req.params.example ?? ''));
		if (!example) {
			res.status(404).type('text/plain').send('Not found');
			return;
		}

		const { clientConfig } = example;
		const image = await buildConsulteeStaticMapResponse({
			geometryId: `interactive-map-example:${example.id}`,
			sectionId: 'components-showcase',
			map: {
				center: clientConfig.center,
				zoom: clientConfig.zoom,
				width: MAP_VIEWPORT.width,
				height: MAP_VIEWPORT.height,
				projectGeojson: example.staticMap.projectGeojson,
				consulteeGeojson: example.staticMap.consulteeGeojson,
				title: example.title,
				description: example.staticMap.alt
			},
			forceSvg,
			ifNoneMatch: typeof req.headers['if-none-match'] === 'string' ? req.headers['if-none-match'] : undefined,
			accept: typeof req.headers.accept === 'string' ? req.headers.accept : undefined
		});

		res
			.status(image.status)
			.set({
				'Cache-Control': image.cacheControl,
				ETag: image.etag,
				...(image.vary ? { Vary: image.vary } : {})
			})
			.type(image.contentType);

		if (image.status === 304) {
			res.end();
			return;
		}

		res.send(image.body);
	};
}
