import type { Handler } from 'express';

/**
 * Add configuration values to locals.
 * The asset filenames below are content-hash fingerprints rewritten by the asset
 * build — after changing any CSS or JavaScript, run `npm run update-fingerprints`
 * in apps/manage and commit this file with the change. Never edit the hashed
 * names by hand: without the regenerated fingerprints the app keeps requesting
 * the old files (served with long-lived immutable cache headers) and the change
 * is never served in hosting environments.
 */
export function addLocalsConfiguration(): Handler {
	return (req, res, next) => {
		res.locals.config = {
			styleFile: 'style-2ce384a4.css',
			govukFrontendJs: 'assets/js/govuk-frontend.min-0391e416.js',
			consulteesMapJs: 'javascripts/consultees-map-71ff93df.js',
			consulteeAutocompleteJs: 'javascripts/consultee-autocomplete-aea54bb1.js',
			consulteeSelectJs: 'javascripts/consultee-select-7c9dbf6b.js',
			blobUploadJs: 'javascripts/blob-upload-cfe8ea96.js',
			sortableTableJs: 'javascripts/sortable-table-4136f0ca.js',
			accessibleAutocompleteJs: 'assets/js/accessible-autocomplete.min-876870ee.js',
			accessibleAutocompleteCss: 'assets/css/accessible-autocomplete.min-4b7a52dc.css',
			vendorInteractiveMapJs: 'vendor/interactive-map/js/index-66cff150.js',
			vendorInteractiveMapCss: 'vendor/interactive-map/css/index-5ba273be.css',
			vendorMaplibreProviderJs: 'vendor/maplibre-provider/js/index-3a0fcba3.js',
			vendorDatasetsPluginJs: 'vendor/datasets-plugin/js/index-21ca1f65.js',
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
