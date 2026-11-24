import type { Handler } from 'express';
import { LOCALS_ASSET_BINDINGS, loadAssetManifest } from './fingerprint-assets.ts';

/**
 * Fallback asset paths, rewritten by the asset build to the latest fingerprints.
 * They are only served when `.static/asset-manifest.json` cannot be read - a
 * source tree that has never been built - so a stale value here cannot 404 a
 * hosting environment. Never edit the hashed names by hand: `npm run build`
 * (or `npm run update-fingerprints`) keeps them in sync with the manifest.
 */
const FALLBACK_ASSET_PATHS: Record<string, string> = {
	styleFile: 'style-299264dc.css',
	govukFrontendJs: 'assets/js/govuk-frontend.min-0391e416.js',
	consulteesMapJs: 'javascripts/consultees-map-9502566e.js',
	consulteeAutocompleteJs: 'javascripts/consultee-autocomplete-aea54bb1.js',
	consulteeSelectJs: 'javascripts/consultee-select-e8c33a98.js',
	blobUploadJs: 'javascripts/blob-upload-cfe8ea96.js',
	sortableTableJs: 'javascripts/sortable-table-4136f0ca.js',
	loadingSpinnerJs: 'javascripts/loading-spinner-d5a4ce0c.js',
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
	vendorMapStylesPluginCss: 'vendor/map-styles-plugin/css/index-d8fa9e70.css'
};

/**
 * The asset paths pages should reference: every binding resolves from the
 * manifest the build wrote into `staticDir`, so the names served always match
 * files on disk. Without a readable manifest the checked-in fallbacks stand in
 * (a build has never run - nothing fingerprinted exists to serve anyway). A
 * missing manifest in production means the fingerprint build did not run there,
 * which is a deploy fault worth shouting about: every asset would 404.
 */
function resolveAssetPaths(staticDir?: string): Record<string, string> {
	const manifest = staticDir ? loadAssetManifest(staticDir) : null;
	if (!manifest) {
		if (staticDir && process.env.NODE_ENV === 'production') {
			console.error(
				`no asset manifest at ${staticDir} - pages will serve fallback asset paths that likely 404; run the asset build`
			);
		}
		return { ...FALLBACK_ASSET_PATHS };
	}
	const resolved: Record<string, string> = { ...FALLBACK_ASSET_PATHS };
	for (const { logical, property } of LOCALS_ASSET_BINDINGS) {
		const hashed = manifest.assets[logical];
		if (hashed) {
			resolved[property] = hashed;
		}
	}
	return resolved;
}

/**
 * Add configuration values to locals. Asset paths resolve once at app start
 * from the build's asset manifest under `staticDir`, falling back to the
 * literals above when no manifest exists - so the fingerprinted filenames
 * served always match the files the same build produced.
 */
export function addLocalsConfiguration(staticDir?: string): Handler {
	const assetPaths = resolveAssetPaths(staticDir);
	return (req, res, next) => {
		res.locals.config = {
			...assetPaths,
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
