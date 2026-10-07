import type { Handler } from 'express';

/**
 * Add configuration values to locals.
 * Asset filenames are rewritten by `npm run build` (content hash + Brotli pipeline).
 */
export function addLocalsConfiguration(): Handler {
	return (req, res, next) => {
		res.locals.config = {
			styleFile: 'style-b1a954b7.css',
			govukFrontendJs: 'assets/js/govuk-frontend.min-38b6270a.js',
			consulteesMapJs: 'javascripts/consultees-map-935d8985.js',
			mapLayersDemoJs: 'javascripts/map-layers-demo-5c32a650.js',
			accessibleAutocompleteJs: 'assets/js/accessible-autocomplete.min-5e8c6959.js',
			accessibleAutocompleteCss: 'assets/css/accessible-autocomplete.min-08028661.css',
			vendorInteractiveMapJs: 'vendor/interactive-map/js/index-6bfcf8f2.js',
			vendorInteractiveMapCss: 'vendor/interactive-map/css/index-194f7266.css',
			vendorMaplibreProviderJs: 'vendor/maplibre-provider/js/index-3c20b9b6.js',
			vendorDatasetsPluginJs: 'vendor/datasets-plugin/js/index-c4efa38e.js',
			vendorDatasetsPluginCss: 'vendor/datasets-plugin/css/index-a29a53aa.css',
			vendorMapKeyPluginJs: 'vendor/map-key-plugin/js/index-27120e8a.js',
			vendorMapKeyPluginCss: 'vendor/map-key-plugin/css/index-405deece.css',
			vendorInteractPluginJs: 'vendor/interact-plugin/js/index-e8f2dc13.js',
			vendorDrawPluginJs: 'vendor/draw-plugin/js/index-2118f08e.js',
			vendorMapStylesPluginJs: 'vendor/map-styles-plugin/js/index-0ffb4b58.js',
			vendorMapStylesPluginCss: 'vendor/map-styles-plugin/css/index-6c3e88dc.css',
			interactiveMapExamplesJs: 'javascripts/interactive-map-examples-452121c5.js',
			headerTitle: 'Identify consultees',
			// the support links the site footer lists - generic Planning Inspectorate pages
			footerLinks: [
				{ text: 'Terms and conditions', link: '/terms-and-conditions' },
				{ text: 'Accessibility statement', link: '/accessibility-statement' },
				{ text: 'Privacy', link: '/privacy' },
				{ text: 'Cookies', link: '/cookies' },
				{ text: 'Contact', link: '/contact' }
			]
		};
		// the "Components" nav item (component showcase) is only shown when ?components=true is in the URL
		res.locals.showComponentsNav = req.query.components === 'true';
		next();
	};
}
