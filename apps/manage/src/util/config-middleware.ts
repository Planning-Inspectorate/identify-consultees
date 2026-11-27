import type { Handler } from 'express';
import type { AssetManifest } from './fingerprint-assets.ts';
import { LOCALS_ASSET_BINDINGS, loadAssetManifest } from './fingerprint-assets.ts';
import { buildMapPrefetchAssets } from './map-prefetch.ts';

/**
 * Logical asset paths used only when `.static/asset-manifest.json` cannot be
 * read (a source tree that has never been built). They are not fingerprinted
 * names and must not be treated as production-safe — production always loads
 * the manifest written by `npm run build`. Never put content hashes here.
 */
const FALLBACK_ASSET_PATHS: Record<string, string> = Object.fromEntries(
	LOCALS_ASSET_BINDINGS.map(({ logical, property }) => [property, logical])
);

/**
 * The asset paths pages should reference: every binding resolves from the
 * manifest the build wrote into `staticDir`, so the names served always match
 * files on disk. Without a readable manifest the logical fallbacks stand in
 * (a build has never run - nothing fingerprinted exists to serve anyway). A
 * missing manifest in production means the fingerprint build did not run there,
 * which is a deploy fault worth shouting about: every asset would 404.
 */
function resolveAssetPaths(staticDir: string | undefined, manifest: AssetManifest | null): Record<string, string> {
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
 * logical placeholders above when no manifest exists - so the fingerprinted
 * filenames served always match the files the same build produced.
 * `mapPrefetchAssets` is the map bundles' idle-time prime list the homepage
 * renders as inert template links for javascripts/prefetch-map-assets.js
 * (see util/map-prefetch.ts).
 */
export function addLocalsConfiguration(staticDir?: string): Handler {
	const manifest = staticDir ? loadAssetManifest(staticDir) : null;
	const assetPaths = resolveAssetPaths(staticDir, manifest);
	const mapPrefetchAssets = buildMapPrefetchAssets({ assetPaths, manifestAssets: manifest?.assets });
	return (req, res, next) => {
		res.locals.config = {
			...assetPaths,
			mapPrefetchAssets,
			headerTitle: 'Identify consultees',
			// Concise document summary for assistive tech and search results (Lighthouse /
			// content best practices). Pages can override via res.locals.metaDescription.
			metaDescription: 'Identify organisations that must be consulted about a national infrastructure project.',
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
