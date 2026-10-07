import type { Handler } from 'express';

/**
 * Add configuration values to locals.
 * Asset filenames are rewritten by `npm run build` (content hash + Brotli pipeline).
 */
export function addLocalsConfiguration(): Handler {
	return (req, res, next) => {
		res.locals.config = {
			styleFile: 'style-9836de53.css',
			govukFrontendJs: 'assets/js/govuk-frontend.min-38b6270a.js',
			consulteesMapJs: 'javascripts/consultees-map-edecec94.js',
			mapLayersDemoJs: 'javascripts/map-layers-demo-5c32a650.js',
			accessibleAutocompleteJs: 'assets/js/accessible-autocomplete.min-876870ee.js',
			accessibleAutocompleteCss: 'assets/css/accessible-autocomplete.min-4b7a52dc.css',
			vendorInteractiveMapJs: 'vendor/interactive-map/js/index-66cff150.js',
			vendorInteractiveMapCss: 'vendor/interactive-map/css/index-9d48e3b1.css',
			vendorMaplibreProviderJs: 'vendor/maplibre-provider/js/index-4bb864af.js',
			vendorDatasetsPluginJs: 'vendor/datasets-plugin/js/index-c4efa38e.js',
			vendorDatasetsPluginCss: 'vendor/datasets-plugin/css/index-1a74fe4f.css',
			vendorMapKeyPluginJs: 'vendor/map-key-plugin/js/index-8b2d2494.js',
			vendorMapKeyPluginCss: 'vendor/map-key-plugin/css/index-aa93b682.css',
			vendorInteractPluginJs: 'vendor/interact-plugin/js/index-8932494c.js',
			vendorDrawPluginJs: 'vendor/draw-plugin/js/index-1f40ff7e.js',
			vendorMapStylesPluginJs: 'vendor/map-styles-plugin/js/index-c9ffb685.js',
			vendorMapStylesPluginCss: 'vendor/map-styles-plugin/css/index-d8fa9e70.css',
			interactiveMapExamplesJs: 'javascripts/interactive-map-examples-452121c5.js',
			headerTitle: 'Identify consultees',
			footerLinks: []
		};
		// the "Components" nav item (component showcase) is only shown when ?components=true is in the URL
		res.locals.showComponentsNav = req.query.components === 'true';
		next();
	};
}
