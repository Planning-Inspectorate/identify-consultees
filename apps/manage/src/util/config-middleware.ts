import type { Handler } from 'express';

/**
 * Add configuration values to locals.
 * Asset filenames are rewritten by `npm run build` (content hash + Brotli pipeline).
 */
export function addLocalsConfiguration(options: { devPagesEnabled?: boolean } = {}): Handler {
	return (req, res, next) => {
		res.locals.config = {
			styleFile: 'style-41000a50.css',
			govukFrontendJs: 'assets/js/govuk-frontend.min-0391e416.js',
			consulteesMapJs: 'javascripts/consultees-map-f8d8cfae.js',
			mapLayersDemoJs: 'javascripts/map-layers-demo-c45988a4.js',
			consulteeAutocompleteJs: 'javascripts/consultee-autocomplete-8efbbdc4.js',
			blobUploadJs: 'javascripts/blob-upload-cfe8ea96.js',
			accessibleAutocompleteJs: 'assets/js/accessible-autocomplete.min-876870ee.js',
			accessibleAutocompleteCss: 'assets/css/accessible-autocomplete.min-4b7a52dc.css',
			vendorInteractiveMapJs: 'vendor/interactive-map/js/index-66cff150.js',
			vendorInteractiveMapCss: 'vendor/interactive-map/css/index-edde00d3.css',
			vendorMaplibreProviderJs: 'vendor/maplibre-provider/js/index-4bb864af.js',
			vendorDatasetsPluginJs: 'vendor/datasets-plugin/js/index-c4efa38e.js',
			vendorDatasetsPluginCss: 'vendor/datasets-plugin/css/index-1a74fe4f.css',
			vendorMapKeyPluginJs: 'vendor/map-key-plugin/js/index-4e840312.js',
			vendorMapKeyPluginCss: 'vendor/map-key-plugin/css/index-aa93b682.css',
			vendorInteractPluginJs: 'vendor/interact-plugin/js/index-8932494c.js',
			vendorDrawPluginJs: 'vendor/draw-plugin/js/index-1f40ff7e.js',
			vendorMapStylesPluginJs: 'vendor/map-styles-plugin/js/index-c9ffb685.js',
			vendorMapStylesPluginCss: 'vendor/map-styles-plugin/css/index-d8fa9e70.css',
			interactiveMapExamplesJs: 'javascripts/interactive-map-examples-1ac7ee52.js',
			headerTitle: 'Identify consultees',
			// the support links the site footer lists - generic Planning Inspectorate pages.
			// `hidden` keeps the page routed but takes its link out of the footer (the list item
			// gets pins-footer__item--hidden): T&Cs and the accessibility statement are hidden
			// until their content has had a proper audit. TEMPORARY - un-hide before go-live
			// (see README.md's "Before go-live: code to remove")
			footerLinks: [
				{ text: 'Help', link: '/help' },
				{ text: 'Terms and conditions', link: '/terms-and-conditions', hidden: true },
				{ text: 'Accessibility statement', link: '/accessibility-statement', hidden: true },
				{
					text: 'Privacy',
					link: 'https://www.gov.uk/government/publications/planning-inspectorate-privacy-notices/customer-privacy-notice'
				},
				{ text: 'Cookies', link: '/cookies' },
				{ text: 'Contact', link: '/contact' }
			]
		};
		// the "Components" nav item (component showcase) is only shown when ?components=true is in the URL,
		// and only exists at all while the dev pages are mounted (see config.ts devPagesEnabled).
		// TEMPORARY - remove before go-live (see README.md's "Before go-live: code to remove")
		res.locals.showComponentsNav = (options.devPagesEnabled ?? true) && req.query.components === 'true';
		next();
	};
}
