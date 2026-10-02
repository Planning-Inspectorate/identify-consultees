import type { Handler } from 'express';

/**
 * Add configuration values to locals.
 * Asset filenames are rewritten by `npm run build` (content hash + Brotli pipeline).
 */
export function addLocalsConfiguration(): Handler {
	return (req, res, next) => {
		res.locals.config = {
			styleFile: 'style-983f2e7f.css',
			govukFrontendJs: 'assets/js/govuk-frontend.min-38b6270a.js',
			consulteesMapJs: 'javascripts/consultees-map-edecec94.js',
			mapLayersDemoJs: 'javascripts/map-layers-demo-5c32a650.js',
			accessibleAutocompleteJs: 'assets/js/accessible-autocomplete.min-5e8c6959.js',
			accessibleAutocompleteCss: 'assets/css/accessible-autocomplete.min-08028661.css',
			vendorInteractiveMapJs: 'vendor/interactive-map/js/index-3d4a74c3.js',
			vendorInteractiveMapCss: 'vendor/interactive-map/css/index-797fdb84.css',
			vendorMaplibreProviderJs: 'vendor/maplibre-provider/js/index-3c20b9b6.js',
			vendorDatasetsPluginJs: 'vendor/datasets-plugin/js/index-c4efa38e.js',
			vendorDatasetsPluginCss: 'vendor/datasets-plugin/css/index-192c4bcd.css',
			vendorMapKeyPluginJs: 'vendor/map-key-plugin/js/index-27120e8a.js',
			vendorMapKeyPluginCss: 'vendor/map-key-plugin/css/index-52fb14ea.css',
			headerTitle: 'Identify consultees',
			footerLinks: []
		};
		// the "Components" nav item (component showcase) is only shown when ?components=true is in the URL
		res.locals.showComponentsNav = req.query.components === 'true';
		next();
	};
}
