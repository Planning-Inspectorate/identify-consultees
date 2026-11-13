import type { Handler } from 'express';

/**
 * Add configuration values to locals.
 * Asset filenames are rewritten by `npm run build` (content hash + Brotli pipeline).
 */
export function addLocalsConfiguration(): Handler {
	return (req, res, next) => {
		res.locals.config = {
			styleFile: 'style-d3a428b3.css',
			govukFrontendJs: 'assets/js/govuk-frontend.min-0391e416.js',
			consulteesMapJs: 'javascripts/consultees-map-fa9eb6e8.js',
			consulteeAutocompleteJs: 'javascripts/consultee-autocomplete-aea54bb1.js',
			consulteeSelectJs: 'javascripts/consultee-select-22a5da5c.js',
			blobUploadJs: 'javascripts/blob-upload-cfe8ea96.js',
			accessibleAutocompleteJs: 'assets/js/accessible-autocomplete.min-876870ee.js',
			accessibleAutocompleteCss: 'assets/css/accessible-autocomplete.min-4b7a52dc.css',
			vendorInteractiveMapJs: 'vendor/interactive-map/js/index-66cff150.js',
			vendorInteractiveMapCss: 'vendor/interactive-map/css/index-5ba273be.css',
			vendorMaplibreProviderJs: 'vendor/maplibre-provider/js/index-4bb864af.js',
			vendorDatasetsPluginJs: 'vendor/datasets-plugin/js/index-c4efa38e.js',
			vendorDatasetsPluginCss: 'vendor/datasets-plugin/css/index-1a74fe4f.css',
			vendorMapKeyPluginJs: 'vendor/map-key-plugin/js/index-4e840312.js',
			vendorMapKeyPluginCss: 'vendor/map-key-plugin/css/index-aa93b682.css',
			vendorInteractPluginJs: 'vendor/interact-plugin/js/index-8932494c.js',
			vendorDrawPluginJs: 'vendor/draw-plugin/js/index-1f40ff7e.js',
			vendorMapStylesPluginJs: 'vendor/map-styles-plugin/js/index-c9ffb685.js',
			vendorMapStylesPluginCss: 'vendor/map-styles-plugin/css/index-d8fa9e70.css',
			headerTitle: 'Identify consultees',
			// the support links the site footer lists - generic Planning Inspectorate pages.
			// Help and Contact are deliberately left out until their content has had a proper
			// audit; the pages themselves stay routed. `hidden` keeps a page routed but takes
			// its link out of the footer (the list item gets pins-footer__item--hidden): the
			// accessibility statement is hidden until its content has had a proper audit.
			footerLinks: [
				{ text: 'Terms and conditions', link: '/terms-and-conditions' },
				{ text: 'Accessibility statement', link: '/accessibility-statement', hidden: true },
				{
					text: 'Privacy',
					link: 'https://www.gov.uk/government/publications/planning-inspectorate-privacy-notices/customer-privacy-notice'
				},
				{ text: 'Cookies', link: '/cookies' }
			]
		};
		next();
	};
}
