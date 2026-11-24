import { readdirSync } from 'node:fs';
import { DEFRA_VENDOR_ROOTS } from './vendor-assets.ts';

/**
 * The map assets the homepage primes during idle time (see
 * public/javascripts/prefetch-map-assets.js). Every journey reaches an
 * interactive map - the project boundary page first, then a category's - so
 * the page most users start from warms the bundles in the HTTP cache before
 * they are needed.
 */

/** One asset to prime, with the `as` type the later page requests it as. */
export interface MapPrefetchAsset {
	href: string;
	as: 'script' | 'style';
}

/**
 * The map pages' fingerprinted entry bundles, as their config-middleware
 * property. Both map pages' sets are primed: the boundary page loads no draw
 * plugin but the category page that follows does.
 */
const ENTRY_ASSET_PROPERTIES: { property: string; as: 'script' | 'style' }[] = [
	{ property: 'vendorInteractiveMapJs', as: 'script' },
	{ property: 'vendorInteractiveMapCss', as: 'style' },
	{ property: 'vendorMaplibreProviderJs', as: 'script' },
	{ property: 'vendorDatasetsPluginJs', as: 'script' },
	{ property: 'vendorDatasetsPluginCss', as: 'style' },
	{ property: 'vendorInteractPluginJs', as: 'script' },
	{ property: 'vendorDrawPluginJs', as: 'script' },
	{ property: 'vendorMapKeyPluginJs', as: 'script' },
	{ property: 'vendorMapKeyPluginCss', as: 'style' },
	{ property: 'vendorMapStylesPluginJs', as: 'script' },
	{ property: 'vendorMapStylesPluginCss', as: 'style' },
	{ property: 'consulteesMapJs', as: 'script' }
];

/**
 * The vendor webpack chunks a map initialisation always pulls: each bundle's
 * im-* named chunk. The numeric chunks (270 of them, ~105MB) load per feature
 * and are left alone; the esri/ol adapters are for providers the app never
 * constructs (it only ever calls defra.maplibreProvider()).
 */
const VENDOR_CHUNK_PATTERN = /^im-.*\.js$/;
const UNUSED_PROVIDER_CHUNK = /-(esri|ol)-/;

export interface MapPrefetchOptions {
	/** The middleware's resolved asset paths (public paths without a leading slash). */
	assetPaths: Record<string, string>;
	/** The build manifest's logical → fingerprinted paths - for the map module's .mjs plugins. */
	manifestAssets?: Record<string, string>;
	/** Vendor roots keyed by public prefix - tests inject their own. */
	vendorRoots?: Readonly<Record<string, string>>;
	/** A root's file listing - tests inject theirs; a missing root lists nothing. */
	listVendorFiles?: (root: string) => string[];
}

/** A vendor directory's files - none when the package layout moved it. */
function vendorFiles(root: string): string[] {
	try {
		return readdirSync(root);
	} catch {
		return [];
	}
}

/**
 * The asset list the homepage's idle-time primer fetches: each map page's
 * fingerprinted entry bundle, every javascripts/*.mjs module (all are the
 * consultees-map plugins the entry point statically imports), and each vendor
 * bundle's im-* chunk. Deduped - a bundle shared across pages is primed once.
 */
export function buildMapPrefetchAssets(options: MapPrefetchOptions): MapPrefetchAsset[] {
	const { assetPaths, manifestAssets = {}, vendorRoots = DEFRA_VENDOR_ROOTS } = options;
	const listVendorFiles = options.listVendorFiles ?? vendorFiles;

	const assets: MapPrefetchAsset[] = [];

	for (const { property, as } of ENTRY_ASSET_PROPERTIES) {
		const path = assetPaths[property];
		if (path) {
			assets.push({ href: `/${path}`, as });
		}
	}

	for (const [logical, hashed] of Object.entries(manifestAssets)) {
		if (/^javascripts\/.+\.mjs$/.test(logical)) {
			assets.push({ href: `/${hashed}`, as: 'script' });
		}
	}

	for (const [prefix, root] of Object.entries(vendorRoots)) {
		if (!prefix.endsWith('/js')) {
			continue;
		}
		let files: string[] = [];
		try {
			files = listVendorFiles(root);
		} catch {
			// a root that can't be listed just primes nothing
		}
		for (const file of files) {
			if (VENDOR_CHUNK_PATTERN.test(file) && !UNUSED_PROVIDER_CHUNK.test(file)) {
				assets.push({ href: `/vendor/${prefix}/${file}`, as: 'script' });
			}
		}
	}

	const seen = new Set<string>();
	return assets.filter((asset) => !seen.has(asset.href) && seen.add(asset.href));
}
